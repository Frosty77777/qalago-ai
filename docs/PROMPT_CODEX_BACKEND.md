# COPY TO CODEX — Participant A / Backend + RAG + Data

You are the lead AI/backend engineer for the 27-hour Build with AI hackathon case "AI guide for Astana walks". Implement production-minded **working code**, not an outline. Read `API_CONTRACT.md` and `27H_TIMELINE.md` first and preserve existing contract fields. Own only `backend/` plus backend-specific docs. Never overwrite `frontend/`.

Product: **QalaGo AI**, a map-based Astana city guide that collects local POIs automatically from OSM/Overpass, retrieves real relevant POIs near the user, and uses Gemini to produce grounded 1–3 recommendations and mini-itineraries.

## Mandatory implementation P0
1. Set up Python 3.12, FastAPI, Pydantic v2, `httpx`, `pytest`, `scikit-learn`, `numpy`, `google-genai` SDK, `python-dotenv`, and CORS for Vite. Create `.env.example` with server-side `GEMINI_API_KEY` and configurable `GEMINI_MODEL`; never commit secrets.
2. Implement `backend/scripts/collect_pois.py` for **automated** city POI harvesting using OSM Overpass API. Fetch nodes/ways/relations for categories relevant to walking: tourism attractions/museums/artwork/viewpoints, leisure parks/gardens/playgrounds, amenity cafe/restaurants/libraries, historic monuments, etc. Use bounded targeted Overpass queries, timeout, retries with jitter, sensible caching. `out center` for ways/relations; center can lie outside polygon so never represent as entrance. Avoid excessive requests and respect community resource. Normalize `id=type/id`, `name`, `lat`, `lon`, `category`, `tags`, `opening_hours`, optional `description`, `source=OpenStreetMap`, `source_url`, `collected_at`. Filter places without meaningful name and coordinates; dedupe by OSM ID and likely duplicates. Store JSON and SQLite or other simple indexed store. Keep last successful dataset if API fails. Include CLI instructions and provenance summary.
3. Implement retrieval: query processing with ru/kk/en synonym mapping; category, distance (Haversine), duration constraints; text ranking (TF-IDF character n-grams or BM25). Prefer hybrid embeddings via `gemini-embedding-001` if API key, cost and time allow; cache place vectors and query only as needed. Use score weights configurable and deterministic. Diversify top POIs to prevent duplicates. Do not claim POI attributes such as power outlets, noise, price, access, ratings, events unless tags or independently sourced content substantiate them.
4. Gemini grounding: send ONLY retrieved POIs to the model, with clear roles source facts vs generated activity suggestion. Use `google-genai` SDK and JSON schema/Pydantic structured output. Response should choose only retrieved IDs. Validate each returned ID against whitelist, clamp visit times, and always fill coordinates and names from canonical DB, never from model. Warn and retry/fallback if model fabricates facts. If no model key / API quota / timeout, return deterministic relevant recommendations without a 500.
5. API implements `GET /api/health`, `GET /api/pois`, `POST /api/recommend` exactly as documented in `API_CONTRACT.md`; Swagger enabled. Hide API key and do not log coordinates or full free-text prompts. Document appropriate privacy policy.
6. Time-based filter: treat OSM opening_hours as optional, support parsing if robust library installed. If open hours unknown do not claim 'open now'. For unknown attributes, either omit them or give explicit uncertainty. Return approx straight-line distance separately from actual walking ETA (null unless validated routing service).
7. Handle 0-POI results gracefully: return empty recommendations and alternatives such as increasing radius or changing category. Server should never invent fallback POIs.
8. Tests in pytest: OSM normalization including way center, valid dataset, source URLs, Haversine near/far, time budget limits, unknown hours, model-ID whitelist, multilingual simple queries, Gemini outage, no results, request validations, no location logging. Mock network/model in tests.
9. Reproducible Windows PowerShell and POSIX run instructions, requirements with bounded versions, `.env.example`, README. Run tests and report counts truthfully; no fake 'all tests pass'.

## P1 only after end-to-end demo works
- Itinerary planner choosing up to 3 compatible stops within total time budget (including conservative travel estimates only when sourced; otherwise clearly approximate time model).
- Weather context through Open-Meteo (timestamps, provider source, fallback). Recommend indoor options for rain if source signals rain; do not assert currently raining if feed failed.
- Place explanation transparency: score components or matched tags; show retrieval vs generation evidence in response.
- Retrieval performance optimizations/cache; API latency diagnostics without personal payloads.
- Optional walking directions via a suitable dedicated walking route API if reliable and rate limits/licensing understood. Never show driving ETA as walking ETA.

## Coordination and deadline
- In first 20 minutes send Participant B a clear API example and establish dev endpoints.
- At hour 5 provide real POI JSON and GET `/api/pois`.
- At hour 9 POST `/api/recommend` must be integrated and deterministic if Gemini absent.
- Feature-freeze by hour 18. Hours 18–24 are tests/docs/integration; last 3 hours are submission buffer.
- If you need to modify a shared contract, get explicit agreement before breaking change.
- At each checkpoint report actual files changed, commands run, test results, blockers, and immediate next action.

Start implementing now. Do not ask me to write every component manually. If a key is required, use `.env.example` and keep fallback functional until I add it. Prioritize the working vertical slice over unverified optional features.
