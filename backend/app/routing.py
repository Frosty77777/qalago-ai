"""Optional pedestrian routing through the 2GIS Routing API.

Only used when TWOGIS_API_KEY is configured. Every failure (no key, timeout, HTTP error,
unexpected body) returns None so recommendations fall back to unrouted visit options;
no walking time or geometry is ever estimated locally.
"""
import asyncio
import math
import re

import httpx

from .config import Settings
from .geo import haversine_m

ROUTING_URL = "https://routing.api.2gis.com/routing/7.0.0/global"
SOURCE = "2GIS Routing API (walking)"
_POINT = re.compile(r"(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)")


class Leg:
    def __init__(self, minutes: int, distance_m: int, coordinates: list[list[float]]):
        self.minutes, self.distance_m, self.coordinates = minutes, distance_m, coordinates


class RoutePlan:
    def __init__(self, order: list[int], legs: list[Leg]):
        self.order, self.legs = order, legs

    @property
    def walk_minutes(self) -> int:
        return sum(leg.minutes for leg in self.legs)

    def geometry(self) -> dict:
        coords: list[list[float]] = []
        for leg in self.legs:
            coords.extend(p for p in leg.coordinates if not coords or p != coords[-1])
        return {"type": "LineString", "coordinates": coords}


def nearest_first(origin: tuple[float, float], points: list[tuple[float, float]]) -> list[int]:
    """Greedy visit order: always walk to the closest remaining stop (straight-line)."""
    remaining, order, here = list(range(len(points))), [], origin
    while remaining:
        nxt = min(remaining, key=lambda i: haversine_m(here[0], here[1], *points[i]))
        order.append(nxt)
        remaining.remove(nxt)
        here = points[nxt]
    return order


def _linestring(selection: str) -> list[list[float]]:
    return [[float(lon), float(lat)] for lon, lat in _POINT.findall(selection)]


def parse_leg(body: dict) -> Leg | None:
    result = (body.get("result") or [None])[0]
    if not isinstance(result, dict) or not isinstance(result.get("total_duration"), (int, float)):
        return None
    coords: list[list[float]] = []
    parts = [result.get("begin_pedestrian_path", {}).get("geometry", {}).get("selection", "")]
    for maneuver in result.get("maneuvers", []):
        for g in (maneuver.get("outcoming_path") or {}).get("geometry", []):
            parts.append(g.get("selection", ""))
    parts.append(result.get("end_pedestrian_path", {}).get("geometry", {}).get("selection", ""))
    for part in parts:
        for point in _linestring(part):
            if not coords or coords[-1] != point:
                coords.append(point)
    if not coords:
        return None
    # A zero-length leg (origin at the place itself) comes back as a single point.
    return Leg(math.ceil(result["total_duration"] / 60), int(result.get("total_distance") or 0), coords)


class WalkingRouter:
    def __init__(self, settings: Settings, transport: httpx.AsyncBaseTransport | None = None):
        self.key, self.timeout, self.transport = settings.twogis_key, settings.routing_timeout, transport

    @property
    def enabled(self) -> bool:
        return bool(self.key)

    async def _leg(self, client: httpx.AsyncClient, a: tuple[float, float], b: tuple[float, float]) -> Leg | None:
        body = {"points": [{"type": "stop", "lat": a[0], "lon": a[1]}, {"type": "stop", "lat": b[0], "lon": b[1]}],
                "transport": "walking", "output": "detailed"}
        response = await client.post(ROUTING_URL, params={"key": self.key}, json=body)
        if response.status_code != 200:
            return None
        return parse_leg(response.json())

    async def plan(self, origin: tuple[float, float], stops: list[tuple[float, float]]) -> RoutePlan | None:
        if not self.enabled or not stops:
            return None
        # ~11 m precision is enough for routing and avoids sending the exact device position.
        origin = (round(origin[0], 4), round(origin[1], 4))
        order = nearest_first(origin, stops)
        path = [origin] + [stops[i] for i in order]
        try:
            async with httpx.AsyncClient(timeout=self.timeout, transport=self.transport) as client:
                legs = await asyncio.wait_for(
                    asyncio.gather(*(self._leg(client, path[i], path[i + 1]) for i in range(len(order)))),
                    timeout=self.timeout)
        except (httpx.HTTPError, asyncio.TimeoutError, ValueError):
            return None
        if any(leg is None for leg in legs):
            return None
        return RoutePlan(order, list(legs))
