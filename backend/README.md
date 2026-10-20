# QalaGo AI backend

Python 3.12 + FastAPI/Pydantic v2.

**Current API (v2): [`../docs/API_V2.md`](../docs/API_V2.md).** `POST /api/plan` turns a natural-language request into real 2GIS places and 2GIS routes (`app/intent.py`, `app/planner.py`, `app/providers/twogis.py`). Google sign-in and sessions live in `app/auth.py` and `app/db.py`. Configuration and deployment: [`../docs/DEPLOYMENT.md`](../docs/DEPLOYMENT.md).

The sections below describe the **legacy v1** OSM pipeline (`/api/recommend`, `/api/pois`), which is still served.

## Quick start — Windows PowerShell

From the project root:

```powershell
cd backend
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.lock.txt
Copy-Item .env.example .env
# Optional: edit .env with your server-side Gemini key/model.
.\.venv\Scripts\python.exe -m app
```

If the launcher does not register Python 3.12, invoke your installed Python 3.12 executable by its full path for the venv step. Activation is unnecessary, so no execution-policy changes are needed. The supplied lock captures the tested versions; `requirements.txt` records bounded direct dependencies for deliberate upgrades.

## Quick start — POSIX

```sh
cd backend
python3.12 -m venv .venv
.venv/bin/python -m pip install -r requirements.lock.txt
cp .env.example .env
.venv/bin/python -m app
```

The HTTP server listens on **http://localhost:8000**, Swagger **http://localhost:8000/docs**. Vite may use `VITE_API_BASE_URL=http://localhost:8000`; default CORS allows localhost/127.0.0.1 port 5173. The bundled, real `data/pois.json` supports immediate use without Gemini or live Overpass. SQLite is regenerated from validated JSON when absent/stale.

## Refresh real city data

In another terminal, from `backend/`, using your venv Python:

```powershell
.\.venv\Scripts\python.exe scripts/collect_pois.py
# Optional bounded area: south west north east
.\.venv\Scripts\python.exe scripts/collect_pois.py --bbox 51.05 71.35 51.18 71.50
```

```sh
.venv/bin/python scripts/collect_pois.py
.venv/bin/python scripts/collect_pois.py --bbox 51.05 71.35 51.18 71.50
```

Restart the API after a successful refresh; it serves a consistent startup snapshot. The collector issues one union query for nodes/ways/relations across relevant tourism/leisure/amenity/historic tags. It uses `out center tags`, a 25-second server timeout, 40-second client timeout, a 16-MiB declared server memory budget, serial retries with jitter (max 3), and Retry-After handling. It rejects Overpass partial/remark responses, invalid coordinates, unnamed elements and empty harvests. Dedupe uses OSM IDs and normalized same-category names within 40 metres, preferring node coordinates over centres.

The successful snapshot is cached for 24 hours by query hash. `--force` bypasses the cache; avoid repeated forced collections on public infrastructure. Set `OVERPASS_USER_AGENT` to a project/contact identifier, and use your own instance for sustained production harvesting. `--bbox` is capped at 0.15 square degrees. Default covers core Astana, not the entire municipal boundary. Missing categories mean missing OSM coverage, not proof that a city has no such places.

Failure exits **2** and keeps the last successful dataset. No-key Gemini still works; no-data collection does not invent seed places. If no dataset is available, the API starts with `poi_count: 0`, `/api/pois` returns `[]` and recommendations return `[]` with actionable warnings. A collector lock prevents concurrent refreshes. If a collector crashes, verify it is no longer running before removing `data/pois.lock`.

`data/provenance.json` describes the supplied snapshot. Each POI retains OSM type/id, source link, tags and collection timestamp. JSON is authoritative; SQLite is a rebuildable indexed store. Keep **© OpenStreetMap contributors** attribution and the ODbL source link visible when displaying or distributing these data: https://www.openstreetmap.org/copyright.

## API

Full shared schema: `docs/API_CONTRACT.md`. Participant B instructions: `docs/FRONTEND_HANDOFF.md`.

```powershell
Invoke-RestMethod http://localhost:8000/api/health
Invoke-RestMethod 'http://localhost:8000/api/pois?limit=3'
$body = @{ query='coffee'; lat=51.089; lon=71.416; max_minutes=60; language='en'; mode='walk'; preferences=@() } | ConvertTo-Json
Invoke-RestMethod http://localhost:8000/api/recommend -Method Post -ContentType 'application/json' -Body $body
```

```sh
curl -s http://localhost:8000/api/health
curl -s 'http://localhost:8000/api/pois?limit=3'
curl -s http://localhost:8000/api/recommend -H 'Content-Type: application/json' \
  -d '{"query":"coffee","lat":51.089,"lon":71.416,"max_minutes":60,"language":"en","mode":"walk","preferences":[]}'
```

Required fields: query (trimmed, 1–500 characters), numeric lat/lon, integer max_minutes (15–240), language ru/kk/en. Defaults: mode=walk, preferences=[]. Validation failures return 422. There are no added POST fields; radius is the server setting `SEARCH_RADIUS_M` (default 4000). `/api/pois` is a paginated **array**, with limit 1–5000 (default 1000) and offset >=0.

## Retrieval and model grounding

1. Normalize Unicode/text and map ru/kk/en category synonyms. Explicit categories/preferences constrain the candidate set; private/no-access tagged features are excluded.
2. SQLite narrows the bbox/categories; exact Haversine rejects candidates outside the radius. For requests under 30 minutes the radius is also capped at 1000 m, and under 60 minutes at 2500 m. These are geographic eligibility rules, not walking-time estimates. TF-IDF uses character n-grams 3–5, including multilingual name tags and category synonyms.
3. Rank by text, category and straight-line distance (weights .50/.35/.15, configurable). Apply duplicate suppression and a small deterministic category-diversity penalty. Unknown unmatchable queries yield no results.
4. If configured, `google-genai` receives only retrieved POI source context, free text/preferences and budget. It selects IDs, exact evidence tags, visit times and audited suggestion codes using a Pydantic schema sent through `response_json_schema`. Raw origin coordinates are not sent. Unknown IDs, duplicated IDs, unsupported evidence and invalid activity/category combinations are rejected. One validation retry shares a 20-second end-to-end deadline; SDK retries are disabled and concurrency bounded.
5. Names, coordinates, category, source and facts always come from canonical data. Localized templates turn audited activity/reason codes into suggestions. Visit durations are clamped; deterministic retrieval is used on missing key, malformed output, quota errors or timeouts. Provider exception text is never logged.

The model does not compose arbitrary factual prose. This deliberate P0 design prevents invented venue attributes from escaping through reason/activity strings. Embeddings are deferred to keep setup, costs and failure behavior predictable. `RETRIEVAL_DEBUG=true` enables only already documented score components/source tags; it never returns hidden model reasoning or request coordinates.

## Time, source uncertainty and privacy

`distance_m` is **straight-line**, not a street route. `walk_minutes`, `walk_time_source` and `route` are null. Visit durations are planning suggestions whose combined total is capped by the requested budget; **travel time is uncalculated**, so the suggestions are alternatives and do not certify a feasible itinerary. Way/relation coordinates are **bounding-box centres**, possibly outside a polygon, never verified entrances.

Raw OSM hours are retained. No hours parser is installed: availability remains `unknown`, including for 24/7 tags. Quietness, outlets, prices, events, ratings and access are never promised. Source tags may be stale or incomplete; verify conditions on site. Data older than `DATA_STALE_DAYS` generate a warning. Airports require separate travel/check-in planning.

No user accounts, stored request history, analytics, location logs or full prompt logs. See `docs/PRIVACY.md` for model disclosure and deployment logging requirements. The supported launcher disables access logs. Use HTTPS, a rate-limiting reverse proxy and restrictive origin configuration before public hosting; configure the proxy to omit bodies/query strings, and keep the API key server-side. This deliverable is a local hackathon backend, not a completed public hosting/security deployment.

## Verification

```powershell
.\.venv\Scripts\python.exe -m pytest -q
# With the server running and real snapshot loaded:
.\.venv\Scripts\python.exe scripts/smoke_api.py
```

```sh
.venv/bin/python -m pytest -q
.venv/bin/python scripts/smoke_api.py
```

Pytest mocks outbound network/model responses, including a real SDK call against a fake HTTP transport. Test fixtures are explicitly synthetic and never loaded by the application. Actual results and remaining limitations are recorded in `docs/CHECKPOINT.md`. See `docs/limitations.md` for deferred P1 features.

## Optional: 2GIS walking routes

Set `TWOGIS_API_KEY` in `backend/.env` (see `.env.example`; never commit it, never put it in `frontend/`). The service then:

- orders the selected places nearest-first from the origin (greedy, straight-line);
- asks the 2GIS Routing API (`transport: walking`) for each leg, in parallel, with an 8-second limit (`ROUTING_TIMEOUT_SECONDS`);
- fills the existing contract fields: `walk_minutes`, `walk_time_source = "2GIS Routing API (walking)"`, `route.ordered_poi_ids`, `route.geometry` (GeoJSON LineString), `route.route_minutes` (total walking), `route.is_approximate = false`;
- drops trailing stops whose walk + visit would overrun `max_minutes`.

The origin is rounded to 4 decimals (~11 m) before it leaves the server. Any 2GIS failure keeps HTTP 200 and returns the previous unrouted visit options with a warning. Code: `app/routing.py`; tests: `tests/test_routing.py` (mocked HTTP).
