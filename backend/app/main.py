from contextlib import asynccontextmanager
import logging
import time
from typing import Annotated

from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware

from .config import Settings
from .grounding import Grounder, ModelGateway
from .models import HealthResponse, PublicPOI, RecommendRequest, RecommendResponse
from .service import RecommendationService
from .store import POIStore


def configure_privacy_logging() -> None:
    # GET query strings can contain coordinates. The supported launcher disables
    # access logging; also guard direct `uvicorn app.main:app` invocations.
    logging.getLogger("uvicorn.access").disabled = True
    for name in ("httpx", "httpcore", "google_genai", "google.genai"):
        logging.getLogger(name).setLevel(logging.CRITICAL)


def create_app(settings: Settings | None = None, gateway: ModelGateway | None = None) -> FastAPI:
    config = settings or Settings.from_env()
    configure_privacy_logging()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        store = POIStore(config.data_path, config.db_path)
        app.state.store = store
        app.state.service = RecommendationService(store, config, Grounder(config, gateway))
        yield

    application = FastAPI(title="QalaGo AI", version="1.0.0", lifespan=lifespan,
        description="OSM-grounded city visit options. Distances are straight-line; walking time and open-now status are unknown.")
    application.add_middleware(CORSMiddleware, allow_origins=list(config.cors_origins),
        allow_credentials=False, allow_methods=["GET", "POST"], allow_headers=["Content-Type"])

    @application.middleware("http")
    async def safe_metrics(request, call_next):
        start = time.perf_counter()
        response = await call_next(request)
        response.headers["X-Process-Time-Ms"] = str(round((time.perf_counter()-start)*1000, 1))
        response.headers["Cache-Control"] = "no-store"
        response.headers["X-Content-Type-Options"] = "nosniff"
        # Only aggregate status/latency; no path, coordinates, body or prompt.
        logging.getLogger("qalago").info("api_response status=%d elapsed_ms=%.1f",
            response.status_code, (time.perf_counter()-start)*1000)
        return response

    @application.get("/api/health", response_model=HealthResponse)
    def health() -> HealthResponse:
        store = application.state.store
        return HealthResponse(poi_count=len(store.pois), llm_enabled=bool(config.api_key),
            dataset_updated_at=store.dataset.collected_at if store.dataset else None)

    @application.get("/api/pois", response_model=list[PublicPOI])
    def pois(limit: Annotated[int, Query(ge=1, le=5000)] = 1000,
             offset: Annotated[int, Query(ge=0)] = 0) -> list[PublicPOI]:
        return [PublicPOI(**p.model_dump(exclude={"source", "collected_at", "coordinate_kind"}),
                          updated_at=p.collected_at)
                for p in application.state.store.pois[offset:offset+limit]]

    @application.post("/api/recommend", response_model=RecommendResponse)
    async def recommend(body: RecommendRequest) -> RecommendResponse:
        return await application.state.service.recommend(body)

    return application


app = create_app()
