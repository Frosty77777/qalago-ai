from datetime import datetime, timezone
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, field_validator, model_validator

Category = Literal["attraction", "museum", "artwork", "viewpoint", "park", "garden",
                   "playground", "cafe", "restaurant", "library", "historic"]
Lat = Annotated[float, Field(ge=-90, le=90, allow_inf_nan=False)]
Lon = Annotated[float, Field(ge=-180, le=180, allow_inf_nan=False)]


class POI(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    id: str = Field(pattern=r"^(node|way|relation)/[1-9][0-9]*$")
    name: str = Field(min_length=1, max_length=500)
    lat: Lat
    lon: Lon
    category: Category
    tags: dict[str, str]
    opening_hours: str | None = None
    description: str | None = None
    source: Literal["OpenStreetMap"] = "OpenStreetMap"
    source_url: str
    collected_at: datetime
    coordinate_kind: Literal["osm_node", "bounding_box_center"]

    @field_validator("name")
    @classmethod
    def meaningful_name(cls, value: str) -> str:
        value = " ".join(value.split())
        if not any(c.isalpha() for c in value) or value.casefold() in {
                "unknown", "unnamed", "без названия", "атаусыз", "no name"}:
            raise ValueError("Meaningful name required")
        return value

    @model_validator(mode="after")
    def provenance(self) -> "POI":
        if self.source_url != "https://www.openstreetmap.org/" + self.id:
            raise ValueError("Source URL does not match OSM ID")
        if self.collected_at.tzinfo is None:
            raise ValueError("Collection timestamp must include timezone")
        expected = "osm_node" if self.id.startswith("node/") else "bounding_box_center"
        if self.coordinate_kind != expected:
            raise ValueError("Coordinate kind does not match element type")
        if self.opening_hours != self.tags.get("opening_hours"):
            raise ValueError("Opening hours must match source tags")
        key = "historic" if self.category == "historic" else (
            "amenity" if self.category in {"cafe", "restaurant", "library"} else
            "leisure" if self.category in {"park", "garden", "playground"} else "tourism")
        valid_values = {"monument", "memorial", "ruins", "archaeological_site", "castle"} if key == "historic" else {self.category}
        if self.tags.get(key) not in valid_values:
            raise ValueError("Category must be substantiated by source tags")
        return self


class Dataset(BaseModel):
    model_config = ConfigDict(extra="forbid")
    schema_version: Literal[1] = 1
    collected_at: datetime
    source: Literal["OpenStreetMap"] = "OpenStreetMap"
    license: Literal["ODbL-1.0"] = "ODbL-1.0"
    attribution: str = "© OpenStreetMap contributors"
    query_bbox: tuple[float, float, float, float]
    endpoint: str
    query_sha256: str
    osm_base_timestamp: str | None = None
    pois: list[POI]

    @model_validator(mode="after")
    def valid_snapshot(self) -> "Dataset":
        if self.collected_at.tzinfo is None:
            raise ValueError("Timezone required")
        south, west, north, east = self.query_bbox
        if not (-90 <= south < north <= 90 and -180 <= west < east <= 180):
            raise ValueError("Invalid collection bbox")
        if len({p.id for p in self.pois}) != len(self.pois):
            raise ValueError("Duplicate OSM IDs")
        if any(p.collected_at != self.collected_at for p in self.pois):
            raise ValueError("Snapshot and POI timestamps differ")
        return self


class RecommendRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    query: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=500)]
    lat: Lat
    lon: Lon
    max_minutes: int = Field(ge=15, le=240, strict=True)
    language: Literal["ru", "kk", "en"]
    mode: Literal["walk", "general"] = "walk"
    preferences: list[Annotated[str, StringConstraints(strip_whitespace=True,
        min_length=1, max_length=80)]] = Field(default_factory=list, max_length=12)

    @field_validator("lat", "lon", mode="before")
    @classmethod
    def numeric_coordinates(cls, value):
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise ValueError("Coordinates must be JSON numbers")
        return value


class PublicPOI(BaseModel):
    """Only GET fields already described by the shared contract."""
    id: str
    name: str
    category: Category
    lat: Lat
    lon: Lon
    source_url: str
    opening_hours: str | None
    tags: dict[str, str]
    description: str | None
    updated_at: datetime


class Recommendation(BaseModel):
    id: str
    name: str
    category: Category
    lat: Lat
    lon: Lon
    distance_m: int = Field(ge=0)
    reason: str
    visit_minutes: int = Field(ge=5, le=60)
    activity: str
    opening_hours: str | None
    source: Literal["OpenStreetMap"] = "OpenStreetMap"
    source_url: str
    facts: list[str]
    walk_minutes: None = None
    walk_time_source: None = None
    availability_status: Literal["unknown"] = "unknown"


class Route(BaseModel):
    ordered_poi_ids: list[str]
    geometry: None = None
    route_minutes: None = None
    is_approximate: Literal[True] = True


class RecommendResponse(BaseModel):
    recommendations: list[Recommendation] = Field(max_length=3)
    route: Route | None = None
    data_updated_at: datetime | None
    warnings: list[str]
    retrieval_debug: list[dict] | None = None


class HealthResponse(BaseModel):
    status: Literal["ok"] = "ok"
    poi_count: int
    llm_enabled: bool
    dataset_updated_at: datetime | None


def utc_now() -> datetime:
    return datetime.now(timezone.utc)
