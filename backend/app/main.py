from contextlib import asynccontextmanager
import logging
import os
import time
from typing import Annotated

from fastapi import FastAPI, Query, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field

from .auth import COOKIE, AuthError, AuthService, TokenVerifier
from .config import Settings
from .db import Database
from .grounding import Grounder, ModelGateway
from .intent import IntentGateway
from .models import HealthResponse, Lat, Lon, PublicPOI, RecommendRequest, RecommendResponse
from .plan_models import GeocodeResult, PlanRequest, PlanResponse
from .planner import Planner
from .providers.twogis import ProviderError, TwoGisClient
from .ratelimit import RateLimiter
from .service import RecommendationService
from .store import POIStore

Language = Annotated[str, Query(pattern="^(ru|kk|en)$")]
PROVIDER_STATUS = {"not_configured": 503, "key_rejected": 502, "rate_limited": 503, "unavailable": 503,
                   "bad_response": 502, "no_route": 502}


class GoogleCredential(BaseModel):
    model_config = ConfigDict(extra="forbid")
    credential: str = Field(min_length=20, max_length=4096)


def error(status: int, kind: str, service: str | None = None, retry_after: int | None = None) -> JSONResponse:
    headers = {"Retry-After": str(retry_after)} if retry_after else None
    return JSONResponse({"error": {"kind": kind, "service": service}}, status_code=status, headers=headers)


def configure_privacy_logging() -> None:
    # GET query strings can contain coordinates. The supported launcher disables
    # access logging; also guard direct `uvicorn app.main:app` invocations.
    logging.getLogger("uvicorn.access").disabled = True
    for name in ("httpx", "httpcore", "google_genai", "google.genai", "google.auth", "urllib3"):
        logging.getLogger(name).setLevel(logging.CRITICAL)
    app_log = logging.getLogger("qalago")
    if not app_log.handlers:
        # One line per event on stdout for `docker compose logs`; messages never contain
        # queries, coordinates, tokens or keys.
        handler = logging.StreamHandler()
        handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s %(message)s"))
        app_log.addHandler(handler)
        app_log.setLevel(os.getenv("LOG_LEVEL", "INFO").upper())
        app_log.propagate = False


def create_app(settings: Settings | None = None, gateway: ModelGateway | None = None,
               twogis: TwoGisClient | None = None, verifier: TokenVerifier | None = None,
               intent_gateway: IntentGateway | None = None) -> FastAPI:
    config = settings or Settings.from_env()
    configure_privacy_logging()
    log = logging.getLogger("qalago")
    plan_limiter = RateLimiter(config.plan_rate_per_minute)
    auth_limiter = RateLimiter(config.auth_rate_per_minute)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        store = POIStore(config.data_path, config.db_path)
        app.state.store = store
        app.state.service = RecommendationService(store, config, Grounder(config, gateway))
        app.state.twogis = twogis or TwoGisClient(config)
        app.state.planner = Planner(config, app.state.twogis, intent_gateway)
        app.state.auth = AuthService(config, Database(config.app_db_path), verifier)
        log.info("startup twogis=%s auth=%s", app.state.twogis.enabled, app.state.auth.enabled)
        yield
        log.info("shutdown")

    application = FastAPI(title="QalaGo AI", version="2.0.0", lifespan=lifespan,
        description="Intent-based place discovery and routing on 2GIS data, with Google sign-in. "
                    "/api/recommend is the legacy OSM endpoint.")
    # Production serves the UI and /api from one origin (see docker-compose.yml), so CORS
    # only matters for split local setups. Credentials are allowed for the explicit list only.
    application.add_middleware(CORSMiddleware, allow_origins=list(config.cors_origins),
        allow_credentials=True, allow_methods=["GET", "POST"], allow_headers=["Content-Type"])

    @application.middleware("http")
    async def safe_metrics(request, call_next):
        start = time.perf_counter()
        response = await call_next(request)
        response.headers["X-Process-Time-Ms"] = str(round((time.perf_counter()-start)*1000, 1))
        response.headers["Cache-Control"] = "no-store"
        response.headers["X-Content-Type-Options"] = "nosniff"
        # Only aggregate status/latency; no path, coordinates, body or prompt.
        log.info("api_response status=%d elapsed_ms=%.1f", response.status_code, (time.perf_counter()-start)*1000)
        return response

    def client_key(request: Request) -> str:
        forwarded = request.headers.get("x-forwarded-for") if config.trust_proxy else None
        if forwarded:
            return forwarded.split(",")[-1].strip()  # Appended by our own proxy; earlier entries are client-controlled.
        return request.client.host if request.client else "unknown"

    def limited(limiter: RateLimiter, request: Request) -> JSONResponse | None:
        allowed, retry = limiter.allow(client_key(request))
        return None if allowed else error(429, "rate_limited_local", retry_after=retry)

    def trusted_origin(request: Request) -> bool:
        # CSRF defence for cookie-changing endpoints: browsers always send Origin on POST.
        origin = request.headers.get("origin")
        return origin is not None and origin in config.cors_origins

    @application.exception_handler(ProviderError)
    async def provider_error(request: Request, exc: ProviderError):
        log.warning("provider_error service=%s kind=%s", exc.service, exc.kind)
        return error(PROVIDER_STATUS[exc.kind], exc.kind, exc.service, retry_after=30 if exc.kind == "rate_limited" else None)

    @application.exception_handler(AuthError)
    async def auth_error(request: Request, exc: AuthError):
        log.info("auth_error kind=%s", exc.kind)
        return error(exc.status, exc.kind, "auth")

    @application.get("/api/health", response_model=HealthResponse)
    def health() -> HealthResponse:
        store = application.state.store
        return HealthResponse(poi_count=len(store.pois), llm_enabled=bool(config.api_key),
            dataset_updated_at=store.dataset.collected_at if store.dataset else None,
            twogis_configured=application.state.twogis.enabled, auth_enabled=application.state.auth.enabled)

    @application.get("/api/config")
    def public_config() -> dict:
        """Browser-safe settings only: both values are public identifiers, not secrets."""
        return {"twogis_map_key": config.twogis_map_key or None,
                "google_client_id": config.google_client_id or None,
                "places_enabled": application.state.twogis.enabled}

    @application.post("/api/plan", response_model=PlanResponse)
    async def plan(body: PlanRequest, request: Request):
        if blocked := limited(plan_limiter, request):
            return blocked
        return await application.state.planner.plan(body)

    @application.get("/api/geocode", response_model=list[GeocodeResult])
    async def geocode(request: Request, q: Annotated[str, Query(min_length=2, max_length=200)],
                      lat: Annotated[Lat | None, Query()] = None, lon: Annotated[Lon | None, Query()] = None,
                      language: Language = "ru"):
        if blocked := limited(plan_limiter, request):
            return blocked
        return await application.state.twogis.geocode(q.strip(), lat, lon, "kk_KZ" if language == "kk" else "ru_KZ")

    @application.get("/api/reverse-geocode")
    async def reverse_geocode(request: Request, lat: Annotated[Lat, Query()], lon: Annotated[Lon, Query()],
                              language: Language = "ru"):
        if blocked := limited(plan_limiter, request):
            return blocked
        name = await application.state.twogis.reverse_geocode(lat, lon, "kk_KZ" if language == "kk" else "ru_KZ")
        return {"name": name}

    @application.post("/api/auth/google")
    async def google_sign_in(body: GoogleCredential, request: Request):
        if blocked := limited(auth_limiter, request):
            return blocked
        if not trusted_origin(request):
            return error(403, "untrusted_origin", "auth")
        user, token = await application.state.auth.sign_in(body.credential)
        response = JSONResponse({"user": user.public()})
        response.set_cookie(COOKIE, token, max_age=int(config.session_days * 86400), httponly=True,
                            secure=config.cookie_secure, samesite="lax", path="/api")
        return response

    @application.get("/api/auth/me")
    def me(request: Request) -> dict:
        user = application.state.auth.user_for(request.cookies.get(COOKIE))
        return {"user": user.public() if user else None, "auth_enabled": application.state.auth.enabled}

    @application.post("/api/auth/logout", status_code=204)
    def logout(request: Request):
        if not trusted_origin(request):
            return error(403, "untrusted_origin", "auth")
        application.state.auth.sign_out(request.cookies.get(COOKIE))
        response = Response(status_code=204)
        response.delete_cookie(COOKIE, path="/api", secure=config.cookie_secure, httponly=True, samesite="lax")
        return response

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
