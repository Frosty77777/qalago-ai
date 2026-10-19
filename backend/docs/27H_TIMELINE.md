# 27-hour joint timeline

Time ranges are elapsed hours from start of work. Do not assume 27 hours must be continuous work; schedule rest and keep submission buffer.

| Hour | Participant A — Codex/backend | Participant B — Claude/frontend | Joint acceptance gate |
|---|---|---|---|
| 0–1 | Create FastAPI skeleton, API models, minimal fixture and `.env.example` | Create Vite React TS skeleton, map and typed API client | Git remote works; same JSON contract; both commands start |
| 1–5 | Harvest OSM Astana nodes/ways/relations; geocode tags; filter/dedupe; store JSON/SQLite with source URL and timestamps; fallback cache | Responsive map-first shell, clickable map origin, current-location permission, search, result cards, loading/errors | Real POI file created and screen shows API-provided pins |
| 5–9 | Hybrid text+distance retrieval, hard constraint filtering, Gemini structured JSON output, ID whitelist, fallback, pytest | Connect `/api/recommend`, cards + provenance + uncertainty, scenarios, map centering | End-to-end: query -> real 1–3 POI -> map, even if Gemini fails |
| 9–11 | Verify three user scenarios, fix ranking; test stale/unknown hours | Fix integration, validate map interactions, responsive QA | Functional core is reliable; tag release v0.1 |
| 11–15 | Route planner with correct time budgets and geofilters; optional walking routing only if reliable | Itinerary timeline and polyline marked approximate when appropriate; localization ru/kk/en | Short-route scenario works; no fabricated ETA |
| 15–18 | Optional weather integration, explainable score components, multilingual search, background re-harvest command | UX polish, smart filters, animations only if cheap, mobile layout, multilingual content | **Feature freeze at hour 18** |
| 18–21 | API pytest suite, local smoke/integration, logging security, CORS deployment readiness, README | E2E scenarios, mobile QA, error states, fix priority defects | Demo works from cold start without manual DB surgery |
| 21–24 | Architecture slide, how retrieval works, ethical limitations, API evidence, GitHub docs | Slides, record and upload YouTube demo, storyboarding, demo script | Required slides, scenario/limits doc, demo link and code ready |
| 24–27 | Fix deployment defects only; submit source links | Practice 5–7 minute talk; check all public links | Deadline buffer: all submission artifacts verified |

## Rollback decisions
- By hour 3, if Overpass unavailable: use verified earlier collected OSM cache with documented collection script; never fabricate data.
- By hour 7, if embeddings are unreliable: use TF-IDF character n-grams + semantic synonyms + Haversine, and still ground Gemini on retrieved POIs.
- By hour 9, if Gemini API unavailable: deterministic sourced recommendations with an explicit fallback marker, continue integration.
- By hour 13, if walking-routing provider unreliable: stop calling it, keep schematic connections and straight-line distances with accurate labels.
- After hour 18: no new major libraries, hosting migrations or redesigns.

## Release gates
- v0.1 (h9–11): end-to-end grounded retrieval on a map.
- v0.2 (h18): differentiated planned itineraries and polished UX.
- v1.0 (h24): tested, documented, demo recorded, submission-ready.

## Suggested practical working method
The team can stagger meals/rest so one person can monitor integration. If the 27h window includes a full night, aim for a short sleep block rather than 27h of consecutive work: fatigue increases integration and submission mistakes. Cut P2 before cutting the final testing/submission blocks.
