"""2GIS routing is mocked with httpx.MockTransport; no real network calls."""
from dataclasses import replace

import asyncio

import httpx
import pytest

from app.grounding import Grounder
from app.models import RecommendRequest
from app.routing import SOURCE, WalkingRouter, nearest_first, parse_leg
from app.service import RecommendationService


def leg_body(seconds, a, b):
    return {"result": [{"total_duration": seconds, "total_distance": 500, "maneuvers": [
        {"outcoming_path": {"geometry": [{"selection": f"LINESTRING({a[1]} {a[0]}, {b[1]} {b[0]})"}]}}]}]}


def transport(seconds=300, status=200, calls=None):
    def handler(request: httpx.Request) -> httpx.Response:
        body = __import__("json").loads(request.content)
        if calls is not None:
            calls.append((request.url.params.get("key"), body))
        a, b = [(p["lat"], p["lon"]) for p in body["points"]]
        return httpx.Response(status, json=leg_body(seconds, a, b) if status == 200 else {"message": "error"})
    return httpx.MockTransport(handler)


def make_service(store, config, router):
    return RecommendationService(store, config, Grounder(config, None), router)


@pytest.fixture
def routed_config(config):
    return replace(config, twogis_key="test-key")


def req(**kw):
    base = dict(query="park cafe museum", lat=51.089, lon=71.416, max_minutes=120, language="en")
    return RecommendRequest(**{**base, **kw})


def test_nearest_first_order():
    assert nearest_first((0, 0), [(0, 3), (0, 1), (0, 2)]) == [1, 2, 0]


def test_parse_leg_rounds_up_minutes_and_reads_geometry():
    leg = parse_leg(leg_body(61, (51.0, 71.0), (51.1, 71.1)))
    assert leg.minutes == 2
    assert leg.coordinates == [[71.0, 51.0], [71.1, 51.1]]
    assert parse_leg({"result": []}) is None
    assert parse_leg(leg_body(0, (51.0, 71.0), (51.0, 71.0))).coordinates == [[71.0, 51.0]]


def test_routed_response_fills_contract_fields(store, routed_config):
    calls = []
    service = make_service(store, routed_config, WalkingRouter(routed_config, transport(300, calls=calls)))
    res = asyncio.run(service.recommend(req()))
    assert res.recommendations and res.route is not None
    assert res.route.is_approximate is False
    assert res.route.ordered_poi_ids == [r.id for r in res.recommendations]
    assert res.route.geometry["type"] == "LineString" and len(res.route.geometry["coordinates"]) >= 2
    assert all(r.walk_minutes == 5 and r.walk_time_source == SOURCE for r in res.recommendations)
    assert res.route.route_minutes == 5 * len(res.recommendations)
    assert sum(r.walk_minutes + r.visit_minutes for r in res.recommendations) <= 120
    # Key goes only to 2GIS; origin is rounded before leaving the server.
    assert calls[0][0] == "test-key"
    assert calls[0][1]["points"][0] == {"type": "stop", "lat": 51.089, "lon": 71.416}
    assert any("2GIS" in w for w in res.warnings)


def test_long_walks_trim_stops_to_budget(store, routed_config):
    service = make_service(store, routed_config, WalkingRouter(routed_config, transport(40 * 60)))
    res = asyncio.run(service.recommend(req(max_minutes=60)))
    assert len(res.recommendations) == 1
    assert res.route.ordered_poi_ids == [res.recommendations[0].id]


@pytest.mark.parametrize("status", [401, 500])
def test_routing_failure_falls_back_to_options(store, routed_config, status):
    service = make_service(store, routed_config, WalkingRouter(routed_config, transport(status=status)))
    res = asyncio.run(service.recommend(req()))
    assert res.recommendations and res.route is None
    assert all(r.walk_minutes is None and r.walk_time_source is None for r in res.recommendations)
    assert any("unavailable" in w for w in res.warnings)


def test_no_key_never_calls_2gis(store, config):
    calls = []
    service = make_service(store, config, WalkingRouter(config, transport(calls=calls)))
    res = asyncio.run(service.recommend(req()))
    assert calls == [] and res.route is None


def test_key_not_in_settings_repr(routed_config):
    assert "test-key" not in repr(routed_config)
