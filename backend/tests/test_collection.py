import asyncio
from datetime import timedelta
import json

import httpx
import pytest
from pydantic import ValidationError

from app.collector import CollectionError, collect, deduplicate, fetch_overpass, make_query, normalize_element
from app.models import Dataset, utc_now
from app.store import POIStore, save_dataset
from conftest import element, STAMP


@pytest.mark.parametrize("kind", ["node", "way", "relation"])
def test_normalize_coordinates_source_and_center(kind):
    poi = normalize_element(element(kind=kind), STAMP)
    assert poi.id == f"{kind}/1"
    assert poi.source_url == f"https://www.openstreetmap.org/{kind}/1"
    assert (poi.lat, poi.lon) == (51.089, 71.416)
    assert poi.coordinate_kind == ("osm_node" if kind == "node" else "bounding_box_center")
    assert poi.source == "OpenStreetMap"
    assert poi.collected_at == STAMP


@pytest.mark.parametrize("patch", [
    {"lat": None}, {"lon": 181}, {"lat": float("nan")}, {"lat": True},
    {"id": 0}, {"id": True}, {"id": "1"}, {"type": "invalid"},
    {"tags": {}}, {"tags": {"name":"123", "amenity":"cafe"}},
    {"tags": {"name":"Unknown", "amenity":"cafe"}},
    {"tags": {"name":"   ", "amenity":"cafe"}},
    {"tags": {"name":"Synthetic test", "amenity":"parking"}},
])
def test_reject_invalid_osm(patch):
    raw = element()
    raw.update(patch)
    assert normalize_element(raw, STAMP) is None


def test_way_without_center_is_not_treated_as_node():
    raw = element(kind="way")
    raw.pop("center")
    raw.update(lat=51,lon=71)
    assert normalize_element(raw, STAMP) is None


def test_hours_and_local_name_preserved():
    e = element(opening_hours="24/7", **{"name:kk":"Сынақ атауы"})
    del e["tags"]["name"]
    p = normalize_element(e, STAMP)
    assert p.name == "Сынақ атауы" and p.opening_hours == "24/7"


def test_dedup_osm_ids_and_near_identical_names():
    a = normalize_element(element(1, name="Synthetic cafe"), STAMP)
    b = normalize_element(element(2, kind="way", lat=51.0891, name="Synthetic cafe"), STAMP)
    c = normalize_element(element(3, lat=51.1, name="Synthetic cafe"), STAMP)
    pois, removed = deduplicate([a,a,b,c])
    assert {p.id for p in pois} == {"node/1","node/3"}
    assert removed == 2


def test_valid_dataset_json_sqlite_and_index_rebuild(config,dataset):
    save_dataset(dataset,config.data_path,config.db_path)
    assert Dataset.model_validate_json(config.data_path.read_bytes()) == dataset
    config.db_path.unlink()
    store=POIStore(config.data_path,config.db_path)
    assert len(store.pois)==9 and store.index_available
    assert {p.id for p in store.near(51.089,71.416,1000,{"cafe"})} == {"node/1","node/5"}


def test_invalid_url_and_duplicate_dataset_rejected(dataset):
    bad=dataset.model_dump(mode="json")
    bad["pois"][0]["source_url"]="https://invalid.example/1"
    with pytest.raises(ValidationError): Dataset.model_validate(bad)
    bad=dataset.model_dump(mode="json")
    bad["pois"].append(bad["pois"][0])
    with pytest.raises(ValidationError): Dataset.model_validate(bad)


def test_query_bounded_and_covers_all_osm_types():
    q=make_query((50.99,71.27,51.25,71.60))
    assert "nwr" in q and "out center tags" in q and "timeout:25" in q
    with pytest.raises(ValueError): make_query((-90,-180,90,180))


def test_retry_jitter_and_retry_after():
    calls=[]; delays=[]
    def handler(request):
        calls.append(request)
        return httpx.Response(429,headers={"Retry-After":"4"}) if len(calls)<3 else httpx.Response(200,json={"elements":[]})
    async def sleeper(delay): delays.append(delay)
    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            return await fetch_overpass(client,"https://osm.example.test", "query",sleep=sleeper)
    assert asyncio.run(run()) == {"elements":[]}
    assert len(calls)==3 and len(delays)==2 and all(d>=4 for d in delays)


@pytest.mark.parametrize("payload", [{"elements":[],"remark":"runtime timeout"}, {}, [1]])
def test_partial_or_malformed_response_rejected(payload):
    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(lambda r:httpx.Response(200,json=payload))) as client:
            await fetch_overpass(client,"https://osm.example.test", "query")
    with pytest.raises(CollectionError): asyncio.run(run())


def test_collect_success_then_cache_avoids_network(config):
    calls=[]
    def handler(request):
        calls.append(request)
        return httpx.Response(200,json={"elements":[element(1),element(2,"park",kind="way")],"osm3s":{"timestamp_osm_base":"2026-10-19T12:00:00Z"}})
    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as c:
            a=await collect(config.data_path,config.db_path,endpoint="https://osm.example.test",user_agent="Test",client=c)
            b=await collect(config.data_path,config.db_path,endpoint="https://osm.example.test",user_agent="Test",client=c)
            return a,b
    a,b=asyncio.run(run())
    assert a["status"]=="collected" and a["poi_count"]==2
    assert b["status"]=="cache_hit" and len(calls)==1


@pytest.mark.parametrize("payload", [{"elements":[]}, {"elements":[],"remark":"timeout"}])
def test_collection_failure_preserves_previous_bytes(config,dataset,payload):
    save_dataset(dataset,config.data_path,config.db_path)
    before=config.data_path.read_bytes()
    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(lambda r:httpx.Response(200,json=payload))) as c:
            return await collect(config.data_path,config.db_path,endpoint="https://osm.example.test",user_agent="Test",force=True,client=c)
    r=asyncio.run(run())
    assert r["status"]=="cached_after_failure"
    assert config.data_path.read_bytes()==before


def test_missing_cache_on_api_rejection_returns_unavailable(config):
    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(lambda r:httpx.Response(400))) as c:
            return await collect(config.data_path,config.db_path,endpoint="https://osm.example.test",user_agent="Test",client=c)
    assert asyncio.run(run())["status"]=="unavailable"
    assert not config.data_path.exists()
