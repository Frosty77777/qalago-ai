"""Request/response schema of the 2GIS discovery and routing API (`/api/plan`)."""
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, field_validator

from .intent import IntentId, TransportId
from .models import Lat, Lon

Signature = Annotated[str, StringConstraints(pattern=r"^[0-9a-f]{16}$")]
HoursStatus = Literal["open", "closes_soon", "unknown"]
Suggestion = Literal["expand_radius", "longer_time", "change_preferences", "change_transport"]


class PlanRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    query: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=500)]
    lat: Lat
    lon: Lon
    max_minutes: int = Field(ge=15, le=240, strict=True)
    language: Literal["ru", "kk", "en"]
    transport: TransportId = "walking"
    # Answer to a clarifying question; replaces the categories parsed from text.
    categories: list[IntentId] = Field(default_factory=list, max_length=3)
    # Route signatures already shown in this exploration session (bounded history).
    seen: list[Signature] = Field(default_factory=list, max_length=60)
    # Signatures that must not be returned at all (the route that was on screen).
    exclude: list[Signature] = Field(default_factory=list, max_length=5)
    radius_level: int = Field(default=0, ge=0, le=2, strict=True)

    @field_validator("lat", "lon", mode="before")
    @classmethod
    def numeric_coordinates(cls, value):
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise ValueError("Coordinates must be JSON numbers")
        return value


class Stop(BaseModel):
    id: str
    name: str
    lat: Lat
    lon: Lon
    category: str
    rubric: str | None
    address: str | None
    rating: float | None
    review_count: int
    hours_status: HoursStatus
    closes_at: str | None
    average_check: int | None
    accessibility: str | None
    laptop_friendly: str | None
    source_url: str
    travel_minutes: int
    travel_distance_m: int
    transit_summary: str | None
    visit_minutes: int


class Score(BaseModel):
    relevance: float
    travel: float
    quality: float
    constraints: float
    total: float


class RouteOption(BaseModel):
    id: Signature
    title: str
    transport: TransportId
    stops: list[Stop] = Field(min_length=1)
    travel_minutes: int
    travel_distance_m: int
    visit_minutes: int
    total_minutes: int
    geometry: dict
    explanation: list[str]
    badges: list[Literal["fastest", "top_rated"]]
    score: Score


class Interpretation(BaseModel):
    categories: list[str]
    free_text: str | None
    transport: TransportId
    transport_from_text: bool
    budget_minutes: int
    budget_from_text: bool
    open_now: bool
    cheap: bool
    accessible: bool
    quiet: bool
    source: Literal["rules", "model", "override"]


class Place(BaseModel):
    """A real 2GIS place shown without a route because routing was unavailable."""
    id: str
    name: str
    lat: Lat
    lon: Lon
    category: str
    rubric: str | None
    address: str | None
    rating: float | None
    review_count: int
    hours_status: Literal["open", "unknown"]
    closes_at: str | None
    source_url: str
    straight_distance_m: int


class ProviderFailure(BaseModel):
    kind: str
    service: str


class PlanResponse(BaseModel):
    status: Literal["ok", "clarify", "empty", "exhausted", "routing_unavailable"]
    options: list[RouteOption] = Field(max_length=3)
    # Only with status "routing_unavailable": matching places, no travel times or paths.
    places: list[Place] = Field(default_factory=list, max_length=3)
    routing_error: ProviderFailure | None = None
    interpretation: Interpretation | None = None
    question: str | None = None
    choices: list[IntentId] = Field(default_factory=list)
    notices: list[str] = Field(default_factory=list)
    suggestions: list[Suggestion] = Field(default_factory=list)
    ranking_note: str | None = None
    radius_m: int | None = None
    attribution: str = "© 2GIS"


class GeocodeResult(BaseModel):
    name: str
    lat: Lat
    lon: Lon
