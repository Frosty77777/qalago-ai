"""2GIS Places, Geocoder and Routing behind one small interface.

Everything 2GIS-specific (URLs, parameters, response shapes, error codes) stays in this
module. Callers receive `Place`, `RouteLeg` and `ProviderError` only. Nothing here caches
provider data: every call is a live request, which keeps us inside the 2GIS terms that
restrict storing directory data.
"""
from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
import logging
import math
import re
from typing import Literal

import httpx

from ..config import Settings

logger = logging.getLogger("qalago")

PLACES_URL = "https://catalog.api.2gis.com/3.0/items"
GEOCODE_URL = "https://catalog.api.2gis.com/3.0/items/geocode"
ROUTING_URL = "https://routing.api.2gis.com/routing/7.0.0/global"
TRANSIT_URL = "https://routing.api.2gis.com/public_transport/2.0"
PLACE_FIELDS = ("items.point,items.schedule,items.rubrics,items.reviews,"
                "items.attribute_groups,items.timezone_offset,items.address_name")

Transport = Literal["walking", "driving", "bicycle", "public_transport"]
ErrorKind = Literal["not_configured", "key_rejected", "rate_limited", "unavailable", "bad_response", "no_route"]
_POINT = re.compile(r"(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)")
# Seven-day keys used by the Places `schedule` field.
DAYS = ("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")


class ProviderError(Exception):
    """A failure the UI can explain. `service` names the 2GIS product that failed."""

    def __init__(self, kind: ErrorKind, service: str, detail: str = ""):
        super().__init__(f"{service}: {kind}")
        self.kind, self.service, self.detail = kind, service, detail


@dataclass(frozen=True)
class Place:
    id: str
    name: str
    lat: float
    lon: float
    address: str | None
    rubrics: tuple[str, ...]
    primary_rubric: str | None
    schedule: dict | None
    tz_offset_min: int | None
    rating: float | None
    review_count: int
    attributes: tuple[tuple[str, str], ...]
    source_url: str
    kind: str

    def has_attribute(self, *fragments: str) -> str | None:
        """Return the provider's own label for the first attribute whose tag contains a fragment."""
        for tag, label in self.attributes:
            if any(f in tag for f in fragments):
                return label
        return None

    def average_check(self) -> int | None:
        for tag, label in self.attributes:
            if tag == "food_service_avg_price":
                digits = re.sub(r"\D", "", label)
                return int(digits) if digits else None
        return None


@dataclass
class RouteLeg:
    transport: Transport
    duration_s: int
    distance_m: int
    coordinates: list[list[float]] = field(default_factory=list)
    summary: str | None = None  # Public transport line names, e.g. "bus 47".

    @property
    def minutes(self) -> int:
        return math.ceil(self.duration_s / 60)


def _linestring(selection: str) -> list[list[float]]:
    return [[float(lon), float(lat)] for lon, lat in _POINT.findall(selection or "")]


def _append(coords: list[list[float]], points: list[list[float]]) -> None:
    for point in points:
        if not coords or coords[-1] != point:
            coords.append(point)


def parse_place(item: dict, city_slug: str) -> Place | None:
    point = item.get("point") or {}
    if not isinstance(point.get("lat"), (int, float)) or not isinstance(point.get("lon"), (int, float)):
        return None
    name = " ".join(str(item.get("name") or "").split())
    if not item.get("id") or not name:
        return None
    rubrics = [r for r in item.get("rubrics") or [] if isinstance(r, dict) and r.get("name")]
    primary = next((r["name"] for r in rubrics if r.get("kind") == "primary"), None)
    reviews = item.get("reviews") or {}
    rating = reviews.get("general_rating")
    count = reviews.get("general_review_count") or 0
    attributes = tuple((a.get("tag", ""), a.get("name", "")) for g in item.get("attribute_groups") or []
                       for a in g.get("attributes") or [] if a.get("tag") and a.get("name"))
    kind = item.get("type") or "branch"
    # Branches are firms; parks and squares often come back as geo objects (adm_div).
    path = "firm" if kind == "branch" else "geo"
    return Place(id=str(item["id"]), name=name, lat=float(point["lat"]), lon=float(point["lon"]),
                 address=item.get("address_name"), rubrics=tuple(r["name"] for r in rubrics),
                 primary_rubric=primary, schedule=item.get("schedule") or None,
                 tz_offset_min=item.get("timezone_offset") if isinstance(item.get("timezone_offset"), int) else None,
                 rating=float(rating) if isinstance(rating, (int, float)) else None,
                 review_count=int(count) if isinstance(count, int) else 0, attributes=attributes,
                 source_url=f"https://2gis.kz/{city_slug}/{path}/{item['id']}", kind=kind)


def parse_route(body: dict, transport: Transport) -> list[RouteLeg]:
    """Parse Routing API 7 results. Several results are alternative paths, best first."""
    legs = []
    for result in body.get("result") or []:
        if not isinstance(result, dict) or not isinstance(result.get("total_duration"), (int, float)):
            continue
        coords: list[list[float]] = []
        _append(coords, _linestring((result.get("begin_pedestrian_path") or {}).get("geometry", {}).get("selection", "")))
        for maneuver in result.get("maneuvers") or []:
            for g in (maneuver.get("outcoming_path") or {}).get("geometry") or []:
                _append(coords, _linestring(g.get("selection", "")))
        _append(coords, _linestring((result.get("end_pedestrian_path") or {}).get("geometry", {}).get("selection", "")))
        if coords:
            legs.append(RouteLeg(transport, int(result["total_duration"]), int(result.get("total_distance") or 0), coords))
    return legs


def parse_transit(body: list, language: str) -> list[RouteLeg]:
    legs = []
    for variant in body if isinstance(body, list) else []:
        if not isinstance(variant, dict) or not isinstance(variant.get("total_duration"), (int, float)):
            continue
        coords: list[list[float]] = []
        names: list[str] = []
        for movement in variant.get("movements") or []:
            alternative = (movement.get("alternatives") or [{}])[0]
            for g in alternative.get("geometry") or []:
                _append(coords, _linestring(g.get("selection", "")))
            for route in movement.get("routes") or []:
                kind = route.get("subtype_name") if language != "en" else route.get("subtype")
                names.extend(f"{kind} {n}".strip() for n in route.get("names") or [])
        if coords:
            legs.append(RouteLeg("public_transport", int(variant["total_duration"]),
                                 int(variant.get("total_distance") or 0), coords, ", ".join(dict.fromkeys(names)) or None))
    return legs


class TwoGisClient:
    """Thin async client. `transport` is injectable so tests never touch the network."""

    def __init__(self, settings: Settings, transport: httpx.AsyncBaseTransport | None = None):
        self.key, self.timeout = settings.twogis_key, settings.routing_timeout
        self.city_slug = settings.twogis_city_slug
        self.transport = transport

    @property
    def enabled(self) -> bool:
        return bool(self.key)

    def _client(self) -> httpx.AsyncClient:
        return httpx.AsyncClient(timeout=self.timeout, transport=self.transport)

    def _require(self, service: str) -> None:
        if not self.key:
            raise ProviderError("not_configured", service)

    async def _send(self, service: str, call) -> httpx.Response:
        """One bounded retry for transient failures (timeouts, 429, 502/503/504). Other 4xx are final."""
        for attempt in range(2):
            try:
                response = await call()
            except httpx.TimeoutException:
                if attempt:
                    raise ProviderError("unavailable", service, "timeout")
                continue
            except httpx.HTTPError:
                if attempt:
                    raise ProviderError("unavailable", service, "network")
                continue
            if response.status_code in (502, 503, 504) and not attempt:
                await asyncio.sleep(.3)
                continue
            if response.status_code == 429 and not attempt:
                # 2GIS keys have a per-second request quota; one short back-off usually clears it.
                retry_after = response.headers.get("Retry-After", "")
                await asyncio.sleep(min(2.0, float(retry_after)) if retry_after.replace(".", "", 1).isdigit() else 1.0)
                continue
            if response.status_code in (401, 403):
                raise ProviderError("key_rejected", service, str(response.status_code))
            if response.status_code == 429:
                raise ProviderError("rate_limited", service)
            if response.status_code >= 500:
                raise ProviderError("unavailable", service, str(response.status_code))
            return response
        raise ProviderError("unavailable", service)

    async def _catalog(self, service: str, url: str, params: dict) -> list[dict]:
        self._require(service)
        async with self._client() as client:
            response = await self._send(service, lambda: client.get(url, params={**params, "key": self.key}))
        try:
            body = response.json()
        except ValueError:
            raise ProviderError("bad_response", service)
        code = (body.get("meta") or {}).get("code")
        if code == 404:
            return []  # 2GIS reports "nothing found" as meta.code 404.
        if code in (401, 403):
            raise ProviderError("key_rejected", service, str(code))
        if code == 429:
            raise ProviderError("rate_limited", service)
        if code != 200:
            raise ProviderError("bad_response", service, str(code))
        items = (body.get("result") or {}).get("items")
        return items if isinstance(items, list) else []

    async def search_places(self, query: str, lat: float, lon: float, radius_m: int,
                            locale: str = "ru_KZ", page_size: int = 10) -> list[Place]:
        items = await self._catalog("places", PLACES_URL, {
            "q": query, "point": f"{lon:.6f},{lat:.6f}", "radius": int(min(max(radius_m, 50), 40000)),
            "page_size": page_size, "fields": PLACE_FIELDS, "locale": locale})
        places = [parse_place(i, self.city_slug) for i in items]
        return [p for p in places if p is not None]

    async def geocode(self, query: str, lat: float | None, lon: float | None, locale: str = "ru_KZ") -> list[dict]:
        params = {"q": query, "fields": "items.point", "page_size": 5, "locale": locale}
        if lat is not None and lon is not None:
            params["location"] = f"{lon:.5f},{lat:.5f}"
        items = await self._catalog("geocoder", GEOCODE_URL, params)
        return [{"name": i.get("full_name") or i.get("name"), "lat": i["point"]["lat"], "lon": i["point"]["lon"]}
                for i in items if (i.get("full_name") or i.get("name")) and isinstance(i.get("point"), dict)]

    async def reverse_geocode(self, lat: float, lon: float, locale: str = "ru_KZ") -> str | None:
        items = await self._catalog("geocoder", GEOCODE_URL, {
            "lat": f"{lat:.5f}", "lon": f"{lon:.5f}", "fields": "items.point", "page_size": 1, "locale": locale})
        first = items[0] if items else {}
        return first.get("address_name") or first.get("name") or first.get("full_name")

    async def route(self, a: tuple[float, float], b: tuple[float, float], transport: Transport,
                    language: str = "ru", alternatives: int = 0) -> list[RouteLeg]:
        """Route one leg. Returns the provider's path first and any alternative paths after it."""
        service = "public_transport" if transport == "public_transport" else "routing"
        self._require(service)
        async with self._client() as client:
            if transport == "public_transport":
                body = {"source": {"point": {"lat": a[0], "lon": a[1]}}, "target": {"point": {"lat": b[0], "lon": b[1]}},
                        "transport": ["pedestrian", "bus", "trolleybus", "tram", "shuttle_bus", "light_metro"],
                        "locale": "en" if language == "en" else "ru"}
                response = await self._send(service, lambda: client.post(TRANSIT_URL, params={"key": self.key}, json=body))
            else:
                body = {"points": [{"type": "stop", "lat": a[0], "lon": a[1]}, {"type": "stop", "lat": b[0], "lon": b[1]}],
                        "transport": transport, "output": "detailed"}
                if alternatives:
                    body["alternative"] = alternatives
                response = await self._send(service, lambda: client.post(ROUTING_URL, params={"key": self.key}, json=body))
        if response.status_code in (400, 404, 422):
            raise ProviderError("no_route", service, str(response.status_code))
        try:
            parsed = response.json()
        except ValueError:
            raise ProviderError("bad_response", service)
        legs = parse_transit(parsed, language) if transport == "public_transport" else parse_route(parsed, transport)
        if not legs:
            raise ProviderError("no_route", service)
        return legs
