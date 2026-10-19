import asyncio
from dataclasses import replace
import json

from fastapi.testclient import TestClient
import httpx
import pytest
from pydantic import ValidationError

from app.collector import fetch_overpass, CollectionError
from app.grounding import GeminiGateway
from app.main import create_app
from app.models import POI, RecommendRequest
from app.retrieval import Retriever, intents
from app.store import POIStore, save_dataset


def test_kazakh_park_not_confused_with_garden(req):
    categories,_,_=intents(req.model_copy(update={"query":"саябақта серуен"}))
    assert categories=={"park"}


@pytest.mark.parametrize("patch", [{"lat":True},{"lon":False},{"lat":"51.089"}])
def test_boolean_or_string_coordinates_rejected(request_body,patch):
    with pytest.raises(ValidationError): RecommendRequest(**(request_body|patch))


def test_raw_hours_never_claim_open(config,dataset,request_body):
    p=dataset.pois[0]
    dataset.pois[0]=POI.model_validate(p.model_dump()|{"tags":p.tags|{"opening_hours":"24/7"},"opening_hours":"24/7"})
    save_dataset(dataset,config.data_path,config.db_path)
    with TestClient(create_app(config)) as client:
        result=client.post("/api/recommend",json=request_body).json()["recommendations"][0]
    assert result["opening_hours"]=="24/7" and result["availability_status"]=="unknown"


def test_private_access_excluded(config,dataset,req):
    for i,p in enumerate(dataset.pois):
        if p.category=="cafe":
            dataset.pois[i]=POI.model_validate(p.model_dump()|{"tags":p.tags|{"access":"private"}})
    save_dataset(dataset,config.data_path,config.db_path)
    assert Retriever(POIStore(config.data_path,config.db_path),config).search(req)==[]


def test_corrupt_dataset_is_safe_empty(config,request_body):
    config.data_path.write_text('{"pois": "invalid"}')
    with TestClient(create_app(config)) as client:
        assert client.get("/api/health").json()["poi_count"]==0
        assert client.post("/api/recommend",json=request_body).json()["recommendations"]==[]


def test_mismatched_tags_cannot_create_unsupported_category(dataset):
    with pytest.raises(ValidationError):
        POI.model_validate(dataset.pois[0].model_dump()|{"category":"museum"})


def test_short_budget_has_a_stricter_geographic_policy(config,dataset,req):
    dataset.pois=[POI.model_validate(p.model_dump()|{"lat":51.105}) for p in dataset.pois if p.category=="cafe"]
    save_dataset(dataset,config.data_path,config.db_path)
    retriever=Retriever(POIStore(config.data_path,config.db_path),config)
    assert retriever.search(req.model_copy(update={"max_minutes":15}))==[]
    assert retriever.search(req.model_copy(update={"max_minutes":60}))


def test_long_retry_after_does_not_retry_public_server():
    calls=[]
    def handler(request):
        calls.append(request)
        return httpx.Response(429,headers={"Retry-After":"600"})
    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            await fetch_overpass(client,"https://osm.example.test","query")
    with pytest.raises(CollectionError,match="retry_later"): asyncio.run(run())
    assert len(calls)==1


def test_sdk_structured_output_and_minimum_user_payload(monkeypatch,store,config,req):
    """Use the installed google-genai SDK against a mocked HTTP transport."""
    from google import genai
    original=genai.Client
    requests=[]
    def handler(request):
        requests.append(request)
        body=json.loads(request.content)
        assert body["generationConfig"]["responseMimeType"]=="application/json"
        schema=body["generationConfig"]["responseJsonSchema"]
        assert "responseSchema" not in body["generationConfig"]
        assert schema["additionalProperties"] is False
        assert schema["$defs"]["ModelChoice"]["additionalProperties"] is False
        assert "additional_properties" not in json.dumps(schema)
        payload=json.loads(body["contents"][0]["parts"][0]["text"])
        assert "lat" not in payload and "lon" not in payload
        p=payload["retrieved_sources"][0]
        answer={"choices":[{"poi_id":p["id"],"visit_minutes":15,"reason_code":"interest_match",
                            "activity_code":"visit","evidence":p["facts"][:1]}]}
        return httpx.Response(200,json={"candidates":[{"content":{"role":"model","parts":[{"text":json.dumps(answer)}]},"finishReason":"STOP"}]})
    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as mock_http:
            def factory(**kwargs):
                kwargs["http_options"].httpx_async_client=mock_http
                return original(**kwargs)
            monkeypatch.setattr(genai,"Client",factory)
            candidates=Retriever(store,config).search(req)
            return await GeminiGateway(replace(config,api_key="test-key")).generate(req,candidates,False)
    result=asyncio.run(run())
    assert result.choices[0].poi_id=="node/1" and len(requests)==1
