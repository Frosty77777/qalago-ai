import asyncio
from dataclasses import replace
import logging

from fastapi.testclient import TestClient
import pytest

from app.grounding import Grounder, ModelChoice, ModelPlan, validate_plan
from app.main import create_app
from app.models import RecommendRequest
from app.retrieval import Retriever, source_facts
from app.store import save_dataset


class Gateway:
    def __init__(self, mode="valid"):
        self.mode=mode; self.calls=0

    async def generate(self,request,candidates,retry):
        self.calls+=1
        c=candidates[0]
        if self.mode=="outage": raise RuntimeError("private query and coordinates must never be logged")
        if self.mode=="timeout": await asyncio.sleep(10)
        choice=ModelChoice(poi_id=c.poi.id,visit_minutes=999,
            reason_code="interest_match" if c.category_match else "nearby",
            activity_code="visit",evidence=source_facts(c.poi)[:1])
        if self.mode=="invented_id": choice.poi_id="node/999999999"
        if self.mode=="fabricated_fact": choice.evidence=["outlets=guaranteed"]
        if self.mode=="invalid_activity": choice.activity_code="read"
        return ModelPlan(choices=[choice])


def client_for(config,dataset,gateway=None,**overrides):
    save_dataset(dataset,config.data_path,config.db_path)
    return TestClient(create_app(replace(config,**overrides),gateway=gateway))


def test_health_pois_and_swagger(config,dataset):
    with client_for(config,dataset) as client:
        health=client.get("/api/health").json()
        assert health["poi_count"]==9 and health["llm_enabled"] is False
        assert client.get("/docs").status_code==200
        assert client.get("/openapi.json").status_code==200
        pois=client.get("/api/pois?limit=2&offset=1").json()
        assert isinstance(pois,list) and len(pois)==2
        assert {"id","name","lat","lon","source_url"} <= pois[0].keys()


@pytest.mark.parametrize("max_minutes", [15,30,60,240])
def test_fallback_contract_time_budget_and_unknown_hours(config,dataset,request_body,max_minutes):
    request_body.update(query="walk",max_minutes=max_minutes)
    with client_for(config,dataset) as client:
        response=client.post("/api/recommend",json=request_body)
    assert response.status_code==200
    r=response.json()
    assert 1<=len(r["recommendations"])<=3
    assert sum(p["visit_minutes"] for p in r["recommendations"])<=max_minutes
    assert r["route"] is None
    for p in r["recommendations"]:
        assert p["availability_status"]=="unknown"
        assert p["walk_minutes"] is None and p["walk_time_source"] is None
        assert p["opening_hours"] is None
        assert p["source"]=="OpenStreetMap"
        assert p["source_url"]=="https://www.openstreetmap.org/"+p["id"]
    assert any("deterministic" in w for w in r["warnings"])


@pytest.mark.parametrize("mode",["outage","timeout","invented_id","fabricated_fact","invalid_activity"])
def test_gemini_failure_is_200_grounded_fallback(config,dataset,request_body,mode):
    gateway=Gateway(mode)
    with client_for(config,dataset,gateway,api_key="test-key",model_timeout=.05) as client:
        response=client.post("/api/recommend",json=request_body)
    assert response.status_code==200
    r=response.json()
    assert r["recommendations"] and all(p["id"] in {"node/1","node/5"} for p in r["recommendations"])
    assert all("guaranteed" not in str(p) for p in r["recommendations"])
    assert gateway.calls==(2 if mode in {"invented_id","fabricated_fact","invalid_activity"} else 1)


def test_gemini_valid_selection_canonical_fields_and_clamped_times(config,dataset,request_body):
    with client_for(config,dataset,Gateway(),api_key="test-key") as client:
        r=client.post("/api/recommend",json=request_body).json()
    p=r["recommendations"][0]
    canonical=next(x for x in dataset.pois if x.id==p["id"])
    assert p["visit_minutes"]==60
    assert (p["name"],p["lat"],p["lon"])==(canonical.name,canonical.lat,canonical.lon)
    assert not any("deterministic" in w for w in r["warnings"])


def test_direct_whitelist_duplicate_and_total_clamping(store,config,req):
    candidates=Retriever(store,config).search(req.model_copy(update={"query":"walk"}))[:3]
    plan=ModelPlan(choices=[ModelChoice(poi_id=c.poi.id,visit_minutes=1000,
        reason_code="nearby",activity_code="visit",evidence=source_facts(c.poi)[:1]) for c in candidates])
    validated=validate_plan(plan,candidates,15)
    assert [x.visit_minutes for x in validated.choices]==[5,5,5]
    plan.choices[1].poi_id=plan.choices[0].poi_id
    with pytest.raises(ValueError): validate_plan(plan,candidates,15)


@pytest.mark.parametrize("patch", [
    {"query":""},{"query":"   "},{"query":"x"*501},
    {"lat":91},{"lat":-91},{"lon":181},{"lon":-181},
    {"max_minutes":14},{"max_minutes":241},{"max_minutes":15.5},{"max_minutes":True},
    {"language":"de"},{"mode":"drive"},{"preferences":"coffee"},{"radius":1000},
])
def test_request_validation_422(config,dataset,request_body,patch):
    request_body.update(patch)
    with client_for(config,dataset) as client:
        assert client.post("/api/recommend",json=request_body).status_code==422


def test_missing_field_422(config,dataset,request_body):
    del request_body["lat"]
    with client_for(config,dataset) as client:
        assert client.post("/api/recommend",json=request_body).status_code==422


def test_empty_dataset_never_invents_places_or_calls_model(config,request_body):
    gateway=Gateway("outage")
    with TestClient(create_app(replace(config,api_key="test-key"),gateway)) as client:
        r=client.post("/api/recommend",json=request_body).json()
        assert client.get("/api/pois").json()==[]
    assert r["recommendations"]==[] and r["data_updated_at"] is None and r["warnings"]
    assert gateway.calls==0


def test_far_origin_returns_empty(config,dataset,request_body):
    request_body.update(lat=0,lon=0)
    with client_for(config,dataset) as client:
        r=client.post("/api/recommend",json=request_body).json()
    assert r["recommendations"]==[] and r["warnings"]


def test_unsupported_attributes_and_airport_uncertainty(config,dataset,request_body):
    request_body["query"]="quiet coffee outlets before airport flight this evening"
    with client_for(config,dataset) as client:
        r=client.post("/api/recommend",json=request_body).json()
    assert any("not guaranteed" in w for w in r["warnings"])
    assert any("Open-now" in w for w in r["warnings"])
    assert any("flight" in w for w in r["warnings"])
    assert all("outlet" not in p["reason"].lower() for p in r["recommendations"])


def test_no_location_prompt_secret_logging(config,dataset,request_body,caplog):
    request_body.update(query="coffee PRIVATE_PROMPT_SENTINEL",lat=51.089123456,lon=71.416123456)
    with caplog.at_level(logging.INFO), client_for(config,dataset,Gateway("outage"),api_key="SECRET_SENTINEL") as client:
        client.post("/api/recommend",json=request_body)
        client.get("/api/pois?lat=51.089123456&query=PRIVATE_PROMPT_SENTINEL")
    assert "api_response" in caplog.text
    for sensitive in ("51.089123456","71.416123456","PRIVATE_PROMPT_SENTINEL","SECRET_SENTINEL","private query"):
        assert sensitive not in caplog.text
    assert logging.getLogger("uvicorn.access").disabled


def test_cors_allowlist_and_no_store(config,dataset):
    with client_for(config,dataset) as client:
        response=client.options("/api/recommend",headers={"Origin":"http://localhost:5173","Access-Control-Request-Method":"POST"})
        denied=client.options("/api/recommend",headers={"Origin":"https://untrusted.example","Access-Control-Request-Method":"POST"})
        health=client.get("/api/health")
    assert response.headers["access-control-allow-origin"]=="http://localhost:5173"
    assert "access-control-allow-origin" not in denied.headers
    assert health.headers["cache-control"]=="no-store"
