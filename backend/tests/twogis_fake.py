"""A deterministic stand-in for 2GIS Places and Routing. Synthetic test data only."""
from datetime import datetime, timezone
import json
import math

import httpx

from app.geo import haversine_m

# Monday 2026-10-19 12:00 in Astana (UTC+5).
NOON = datetime(2026, 10, 19, 7, tzinfo=timezone.utc)
ORIGIN = (51.0900, 71.4200)
WEEK = {d: {"working_hours": [{"from": "08:00", "to": "22:00"}]} for d in ("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")}


def place(pid, name, rubric, dlat, dlon=0.0, rating=4.5, reviews=50, schedule=WEEK, attributes=(), kind="branch"):
    return {"id": pid, "name": name, "type": kind, "point": {"lat": ORIGIN[0] + dlat, "lon": ORIGIN[1] + dlon},
            "address_name": f"Test street {pid}", "rubrics": [{"name": rubric, "kind": "primary"}],
            "schedule": schedule, "timezone_offset": 300,
            "reviews": {"general_rating": rating, "general_review_count": reviews},
            "attribute_groups": [{"attributes": [{"tag": t, "name": n} for t, n in attributes]}]}


COFFEE = [
    place("c1", "Test Coffee One", "Кофейни", .004),
    place("c2", "Test Coffee Two", "Кофейни", .006),
    place("c3", "Test Coffee Three", "Кофейни", .008, rating=4.9, reviews=300),
    place("c4", "Test Coffee Four", "Кофейни", .010),
    place("c5", "Test Coffee Closed Monday", "Кофейни", .003, schedule={"Tue": WEEK["Tue"]}),
    place("x1", "Coffee-named clothing shop", "Одежда", .002),
]
PARKS = [place("p1", "Test Park North", "Парки", -.006, schedule=None, kind="adm_div"),
         place("p2", "Test Park East", "Парки", 0, .010, schedule=None, kind="adm_div")]
DATA = {"кофейня": COFFEE, "парк": PARKS, "сквер": [],
        "ресторан": [place("r1", "Test Bistro", "Рестораны", .005, attributes=[("food_service_avg_price", "Чек 6000 ₸")]),
                     place("r2", "Test Canteen", "Столовые", .007, attributes=[("food_service_avg_price", "Чек 1500 ₸")])],
        "кафе": [], "test tower": [place("t1", "Test Tower", "Достопримечательности", .009)]}


def line(a, b):
    return f"LINESTRING({a[1]} {a[0]}, {(a[1] + b[1]) / 2} {(a[0] + b[0]) / 2}, {b[1]} {b[0]})"


def make_transport(data=DATA, calls=None, places_status=200, places_code=200, routing_status=200, alternative_detour=None):
    def handler(request: httpx.Request) -> httpx.Response:
        if calls is not None:
            calls.append(request)
        if request.url.host == "catalog.api.2gis.com":
            if places_status != 200:
                return httpx.Response(places_status, json={})
            if places_code != 200:
                return httpx.Response(200, json={"meta": {"code": places_code}})
            items = data.get(request.url.params["q"], [])
            if not items:
                return httpx.Response(200, json={"meta": {"code": 404, "error": {"type": "itemNotFound"}}})
            return httpx.Response(200, json={"meta": {"code": 200}, "result": {"items": items, "total": len(items)}})
        if routing_status != 200:
            return httpx.Response(routing_status, json={"message": "error"})
        body = json.loads(request.content)
        a, b = [(p["lat"], p["lon"]) for p in body["points"]]
        meters = haversine_m(*a, *b)
        results = [{"total_duration": math.ceil(meters / 70) * 60, "total_distance": int(meters * 1.2),
                    "maneuvers": [{"outcoming_path": {"geometry": [{"selection": line(a, b)}]}}]}]
        if body.get("alternative") and alternative_detour is not None:
            via = (a[0] + alternative_detour[0], a[1] + alternative_detour[1])
            results.append({"total_duration": results[0]["total_duration"] + 300, "total_distance": int(meters * 1.6),
                            "maneuvers": [{"outcoming_path": {"geometry": [{"selection": line(a, via)}, {"selection": line(via, b)}]}}]})
        return httpx.Response(200, json={"status": "OK", "result": results})
    return httpx.MockTransport(handler)
