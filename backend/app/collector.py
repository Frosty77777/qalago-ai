"""One bounded Overpass request, serial retries, cached complete snapshots."""
import asyncio
from datetime import datetime, timedelta, timezone
from collections import Counter
import hashlib
import math
from pathlib import Path
import random
import re
import sqlite3
from typing import Callable

import httpx
from pydantic import ValidationError

from .geo import haversine_m
from .models import Dataset, POI, utc_now
from .store import atomic_write, save_dataset

DEFAULT_BBOX = (50.99, 71.27, 51.25, 71.60)  # core Astana; not entire municipal boundary
FILTERS = {
    "tourism": ("attraction", "museum", "artwork", "viewpoint"),
    "leisure": ("park", "garden", "playground"),
    "amenity": ("cafe", "restaurant", "library"),
    "historic": ("monument", "memorial", "ruins", "archaeological_site", "castle"),
}


class CollectionError(RuntimeError):
    """Safe event message only: never includes response bodies."""


def make_query(bbox: tuple[float, float, float, float]) -> str:
    south, west, north, east = bbox
    if not all(math.isfinite(v) for v in bbox) or not (
        -90 <= south < north <= 90 and -180 <= west < east <= 180
    ) or (north-south) * (east-west) > .15:
        raise ValueError("Use a bounded bbox of at most 0.15 square degrees")
    bounds = ",".join(f"{v:.6f}" for v in bbox)
    parts = [f'nwr["{key}"~"^({"|".join(values)})$"]["name"]({bounds});'
             for key, values in FILTERS.items()]
    return '[out:json][timeout:25][maxsize:16777216];(' + "".join(parts) + ');out center tags;'


def category_for(tags: dict[str, str]) -> str | None:
    for key, values in FILTERS.items():
        if tags.get(key) in values:
            return "historic" if key == "historic" else tags[key]
    return None


def normalize_element(element: dict, collected_at: datetime) -> POI | None:
    kind, identifier = element.get("type"), element.get("id")
    if kind not in {"node", "way", "relation"} or not isinstance(identifier, int) or isinstance(identifier, bool) or identifier <= 0:
        return None
    tags = element.get("tags")
    if not isinstance(tags, dict):
        return None
    tags = {str(k): str(v) for k, v in tags.items() if isinstance(v, str)}
    name = tags.get("name") or tags.get("name:kk") or tags.get("name:ru") or tags.get("name:en")
    category = category_for(tags)
    if not name or not category:
        return None
    coordinate = element if kind == "node" else element.get("center", {})
    if not isinstance(coordinate, dict):
        return None
    try:
        lat, lon = coordinate["lat"], coordinate["lon"]
        if isinstance(lat, bool) or isinstance(lon, bool):
            return None
        return POI(
            id=f"{kind}/{identifier}", name=name, lat=lat, lon=lon, category=category,
            tags=tags, opening_hours=tags.get("opening_hours"),
            description=next((tags[k][:1500] for k in ("description", "description:ru", "description:kk", "description:en") if tags.get(k)), None),
            source_url=f"https://www.openstreetmap.org/{kind}/{identifier}",
            collected_at=collected_at,
            coordinate_kind="osm_node" if kind == "node" else "bounding_box_center",
        )
    except (KeyError, TypeError, ValidationError):
        return None


def name_key(name: str) -> str:
    return re.sub(r"[^\w]+", "", name.casefold().replace("ё", "е"))


def deduplicate(pois: list[POI]) -> tuple[list[POI], int]:
    # Prefer a tagged node to a polygon centre, then richer source tags.
    result: list[POI] = []
    ids: set[str] = set()
    groups: dict[tuple[str, str], list[POI]] = {}
    for p in sorted(pois, key=lambda p: (p.coordinate_kind != "osm_node", -len(p.tags), p.id)):
        key = (name_key(p.name), p.category)
        duplicate = p.id in ids or any(haversine_m(p.lat, p.lon, q.lat, q.lon) <= 40 for q in groups.get(key, []))
        if duplicate:
            continue
        ids.add(p.id)
        groups.setdefault(key, []).append(p)
        result.append(p)
    return sorted(result, key=lambda p: p.id), len(pois) - len(result)


async def fetch_overpass(client: httpx.AsyncClient, endpoint: str, query: str,
                         *, sleep: Callable = asyncio.sleep, attempts: int = 3) -> dict:
    for attempt in range(attempts):
        delay = 2 ** (attempt + 1) + random.uniform(.5, 2)
        try:
            response = await client.post(endpoint, data={"data": query})
            if response.status_code in {429, 502, 503, 504}:
                header = response.headers.get("Retry-After")
                if header:
                    try:
                        delay = max(delay, float(header))
                    except ValueError:
                        # HTTP-date support, including explicitly timezone-aware values.
                        from email.utils import parsedate_to_datetime
                        try:
                            delay = max(delay, (parsedate_to_datetime(header)-utc_now()).total_seconds())
                        except (ValueError, TypeError, OverflowError):
                            raise CollectionError("overpass_invalid_retry_after") from None
                if delay > 60:
                    raise CollectionError("overpass_retry_later")
                raise httpx.TransportError("retryable_status")
            response.raise_for_status()
            if len(response.content) > 32 * 1024 * 1024:
                raise CollectionError("overpass_response_too_large")
            data = response.json()
            if not isinstance(data, dict) or not isinstance(data.get("elements"), list) or data.get("remark"):
                raise CollectionError("overpass_incomplete_response")
            return data
        except (httpx.TimeoutException, httpx.TransportError):
            if attempt + 1 == attempts:
                break
            await sleep(delay)
        except (httpx.HTTPStatusError, ValueError):
            raise CollectionError("overpass_rejected_or_invalid_response") from None
    raise CollectionError("overpass_unavailable")


async def collect(json_path: Path, db_path: Path, *, endpoint: str, user_agent: str,
                  bbox: tuple = DEFAULT_BBOX, cache_hours: float = 24,
                  force: bool = False, client: httpx.AsyncClient | None = None) -> dict:
    query = make_query(bbox)
    query_hash = hashlib.sha256(query.encode()).hexdigest()
    previous = None
    if json_path.exists():
        try:
            previous = Dataset.model_validate_json(json_path.read_bytes())
        except (ValueError, OSError):
            pass
    if previous and not force and previous.query_sha256 == query_hash and (
            utc_now()-previous.collected_at < timedelta(hours=cache_hours)):
        # Rebuild a missing/broken SQLite index without another public API call.
        try:
            save_dataset(previous, json_path, db_path)
        except (OSError, sqlite3.Error):
            # The validated JSON remains usable even if its optional index cannot be rebuilt.
            return {"status": "cache_hit", "poi_count": len(previous.pois),
                    "collected_at": previous.collected_at.isoformat(), "warning": "index_rebuild_failed"}
        return {"status": "cache_hit", "poi_count": len(previous.pois), "collected_at": previous.collected_at.isoformat()}
    stage = "fetch"
    try:
        if client is None:
            async with httpx.AsyncClient(timeout=httpx.Timeout(40, connect=10),
                    headers={"User-Agent": user_agent}, follow_redirects=False) as owned:
                raw = await fetch_overpass(owned, endpoint, query)
        else:
            raw = await fetch_overpass(client, endpoint, query)
        collected_at = utc_now()
        normalized = [p for e in raw["elements"] if isinstance(e, dict)
                      and (p := normalize_element(e, collected_at)) is not None]
        pois, duplicates = deduplicate(normalized)
        if not pois:
            raise CollectionError("overpass_no_valid_named_pois")
        dataset = Dataset(collected_at=collected_at, query_bbox=bbox, endpoint=endpoint,
            query_sha256=query_hash, osm_base_timestamp=raw.get("osm3s", {}).get("timestamp_osm_base"), pois=pois)
        stage = "write"
        save_dataset(dataset, json_path, db_path)
        result = {"status": "collected", "raw_elements": len(raw["elements"]),
                "poi_count": len(pois), "duplicates_removed": duplicates,
                "filtered_elements": len(raw["elements"])-len(normalized),
                "collected_at": collected_at.isoformat(), "query_sha256": query_hash}
        summary = dataset.model_dump(mode="json", exclude={"pois"}) | result | {
            "category_counts": dict(Counter(p.category for p in pois)),
            "element_counts": dict(Counter(p.id.split("/")[0] for p in pois)),
        }
        try:
            import json
            atomic_write(json_path.with_name("provenance.json"),
                         json.dumps(summary, ensure_ascii=False, indent=2).encode("utf-8"))
        except OSError:
            result["warning"] = "provenance_summary_write_failed"
        return result
    except (CollectionError, OSError, sqlite3.Error) as exc:
        return {"status": "cached_after_failure" if previous else "unavailable",
                "poi_count": len(previous.pois) if previous else 0,
                "collected_at": previous.collected_at.isoformat() if previous else None,
                "error": str(exc) if isinstance(exc, CollectionError) else f"{stage}_failed",
                "error_type": type(exc).__name__}
