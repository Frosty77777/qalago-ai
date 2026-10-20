"""Discovery -> routing -> ranking -> "another route", against the fake 2GIS in twogis_fake."""
import asyncio
from dataclasses import replace

import pytest

from app.plan_models import PlanRequest
from app.planner import Planner, overlap, path_cells, signature
from app.providers.twogis import ProviderError, TwoGisClient
from tests.twogis_fake import NOON, ORIGIN, make_transport


@pytest.fixture
def keyed(config):
    return replace(config, twogis_key="test-key")


def planner(keyed, **fake):
    calls = fake.pop("calls", None)
    return Planner(keyed, TwoGisClient(keyed, make_transport(calls=calls, **fake)), clock=lambda: NOON)


def ask(p, query="Хочу кофе", **kw):
    base = dict(query=query, lat=ORIGIN[0], lon=ORIGIN[1], max_minutes=60, language="ru")
    return asyncio.run(p.plan(PlanRequest(**{**base, **kw})))


def test_coffee_finds_real_cafes_then_routes_to_them(keyed):
    calls = []
    res = ask(planner(keyed, calls=calls))
    assert res.status == "ok" and len(res.options) == 3
    ids = [o.stops[0].id for o in res.options]
    assert set(ids) <= {"c1", "c2", "c3", "c4"}
    # A place outside the rubric and a place closed on Monday never become destinations.
    assert "x1" not in ids and "c5" not in ids
    searches = [c for c in calls if c.url.host == "catalog.api.2gis.com"]
    routes = [c for c in calls if c.url.host == "routing.api.2gis.com"]
    assert searches and routes
    for option in res.options:
        stop = option.stops[0]
        assert option.travel_minutes == stop.travel_minutes > 0
        assert option.total_minutes == option.travel_minutes + option.visit_minutes
        assert option.geometry["coordinates"][-1] == [stop.lon, stop.lat]
        assert stop.source_url.startswith("https://2gis.kz/astana/firm/")
        assert stop.hours_status == "open" and stop.closes_at == "22:00"
    assert any("закрытые" in n for n in res.notices)


def test_ranking_is_ordered_by_documented_score(keyed):
    res = ask(planner(keyed))
    totals = [o.score.total for o in res.options]
    assert totals == sorted(totals, reverse=True)
    for o in res.options:
        s = o.score
        assert o.score.total == pytest.approx(.4 * s.relevance + .3 * s.travel + .15 * s.quality + .15 * s.constraints, abs=2e-3)
    assert "fastest" in res.options[[o.travel_minutes for o in res.options].index(min(o.travel_minutes for o in res.options))].badges
    assert res.ranking_note and "40%" in res.ranking_note


def test_another_route_never_repeats_and_reports_exhaustion(keyed):
    p = planner(keyed)
    first = ask(p)
    seen = [o.id for o in first.options]
    second = ask(p, seen=seen, exclude=seen[:1])
    assert second.status == "ok" and second.options
    assert not {o.id for o in second.options} & set(seen)
    seen += [o.id for o in second.options]
    third = ask(p, seen=seen, exclude=seen[-1:])
    assert third.status == "exhausted" and third.options == []
    assert "expand_radius" in third.suggestions and "change_preferences" in third.suggestions


def test_new_request_without_history_is_empty_not_exhausted(keyed):
    res = ask(planner(keyed), "Хочу в Несуществующее место")
    assert res.status == "empty" and "expand_radius" in res.suggestions


def test_route_identity_ignores_presentation():
    assert signature("walking", ["a", "b"]) == signature("walking", ["a", "b"])
    assert signature("walking", ["a", "b"]) != signature("driving", ["a", "b"])
    assert signature("walking", ["a", "b"]) != signature("walking", ["a"])
    path = [[71.42, 51.09], [71.425, 51.095], [71.43, 51.10]]
    jitter = [[x + 1e-5, y - 1e-5] for x, y in path]
    assert overlap(path_cells(path), path_cells(jitter)) >= .7


def test_combined_request_builds_distinct_two_stop_routes(keyed):
    res = ask(planner(keyed), "I have two hours and want coffee and a walk", language="en")
    assert res.status == "ok" and res.interpretation.budget_minutes == 120 and res.interpretation.budget_from_text
    for o in res.options:
        assert {s.category for s in o.stops} == {"coffee", "park"}
        assert o.travel_minutes == sum(s.travel_minutes for s in o.stops)
    assert len({tuple(s.id for s in o.stops) for o in res.options}) == len(res.options)
    # Parks without a 2GIS schedule are "unknown", never "open".
    assert all(s.hours_status == "unknown" for o in res.options for s in o.stops if s.category == "park")


def test_alternative_paths_must_be_materially_different(keyed):
    near = ask(planner(keyed, alternative_detour=(0, .0001)), "Хочу в Test Tower", transport="driving")
    assert len(near.options) == 1
    far = ask(planner(keyed, alternative_detour=(.03, .03)), "Хочу в Test Tower", transport="driving")
    assert len(far.options) == 2 and far.options[0].id != far.options[1].id
    assert {o.stops[0].id for o in far.options} == {"t1"}


def test_budget_and_price_constraints(keyed):
    tight = ask(planner(keyed), max_minutes=15)
    assert all(o.total_minutes <= 15 for o in tight.options)
    cheap = ask(planner(keyed), "Хочу недорого поесть")
    assert [o.stops[0].id for o in cheap.options] == ["r2"]  # r1 has a 6000 ₸ average check.
    assert cheap.options[0].stops[0].average_check == 1500


def test_vague_request_asks_a_short_question(keyed):
    res = ask(planner(keyed), "Куда сходить?")
    assert res.status == "clarify" and res.question and "coffee" in res.choices
    answered = ask(planner(keyed), "Куда сходить?", categories=["coffee"])
    assert answered.status == "ok"


def test_missing_key_is_reported_not_faked(config):
    with pytest.raises(ProviderError) as exc:
        ask(Planner(config, TwoGisClient(config), clock=lambda: NOON))
    assert exc.value.kind == "not_configured"


@pytest.mark.parametrize("fake, kind", [
    ({"places_status": 403}, "key_rejected"),
    ({"places_code": 403}, "key_rejected"),
    ({"places_status": 429}, "rate_limited"),
    ({"places_status": 503}, "unavailable"),
])
def test_provider_failures_raise_typed_errors(keyed, fake, kind):
    with pytest.raises(ProviderError) as exc:
        ask(planner(keyed, **fake))
    assert exc.value.kind == kind


def test_unroutable_places_are_skipped_without_inventing_routes(keyed):
    res = ask(planner(keyed, routing_status=422))
    assert res.status == "empty" and res.options == []


@pytest.mark.parametrize("status, kind", [(403, "key_rejected"), (429, "rate_limited"), (503, "unavailable")])
def test_routing_outage_shows_real_places_without_routes(keyed, status, kind):
    res = ask(planner(keyed, routing_status=status))
    assert res.status == "routing_unavailable" and res.options == []
    assert res.routing_error.kind == kind and res.routing_error.service == "routing"
    assert 0 < len(res.places) <= 3 and {p.id for p in res.places} <= {"c1", "c2", "c3", "c4"}
    assert all(p.straight_distance_m > 0 for p in res.places)


def test_routing_calls_are_bounded(keyed):
    calls = []
    ask(planner(keyed, calls=calls))
    assert len([c for c in calls if c.url.host == "routing.api.2gis.com"]) == 3
