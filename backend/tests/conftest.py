"""All POIs below are synthetic test fixtures, never demo/production seed data."""
from dataclasses import replace
from datetime import datetime, timezone

import httpx
import pytest

from app.collector import normalize_element
from app.config import Settings
from app.models import Dataset, RecommendRequest
from app.store import POIStore, save_dataset

STAMP = datetime(2026, 10, 19, 12, tzinfo=timezone.utc)


def element(identifier=1, category="cafe", lat=51.089, lon=71.416, kind="node", **tags):
    key = "historic" if category == "historic" else (
        "amenity" if category in {"cafe", "restaurant", "library"} else
        "leisure" if category in {"park", "garden", "playground"} else "tourism")
    value = "monument" if category == "historic" else category
    e = {"type": kind, "id": identifier, "tags": {"name": f"Synthetic test {category} {identifier}", key: value, **tags}}
    e.update({"lat": lat, "lon": lon} if kind == "node" else {"center": {"lat": lat, "lon": lon}})
    return e


@pytest.fixture(autouse=True)
def deny_real_http(monkeypatch):
    async def denied(*args, **kwargs):
        raise AssertionError("Test attempted a real network call")
    monkeypatch.setattr(httpx.AsyncHTTPTransport, "handle_async_request", denied)


@pytest.fixture
def config(tmp_path):
    return Settings(data_path=tmp_path/"pois.json", db_path=tmp_path/"pois.sqlite3", api_key="",
                    app_db_path=tmp_path/"app.sqlite3")


@pytest.fixture
def dataset():
    entries = [element(1), element(2, "park", lat=51.09),
               element(3, "museum", lat=51.091, kind="way"),
               element(4, "playground", lat=51.092),
               element(5, "cafe", lat=51.093),
               element(6, "library", lat=51.094),
               element(7, "historic", lat=51.095),
               element(8, "restaurant", lat=51.096),
               element(9, "cafe", lat=52.0)]
    return Dataset(collected_at=STAMP, query_bbox=(50.99,71.27,51.25,71.60),
        endpoint="https://overpass.example.test/api/interpreter", query_sha256="test-only",
        pois=[normalize_element(e, STAMP) for e in entries])


@pytest.fixture
def store(config, dataset):
    save_dataset(dataset, config.data_path, config.db_path)
    return POIStore(config.data_path, config.db_path)


@pytest.fixture
def request_body():
    return {"query":"coffee", "lat":51.089, "lon":71.416,
            "max_minutes":60, "language":"en", "mode":"walk", "preferences":[]}


@pytest.fixture
def req(request_body):
    return RecommendRequest(**request_body)
