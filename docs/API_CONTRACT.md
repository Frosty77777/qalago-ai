> **Legacy (v1, OpenStreetMap).** Still served by the backend; the current UI uses [API_V2.md](API_V2.md).

# Frozen contract — QalaGo AI v1

Do not change existing field names during parallel development. Add optional fields only after agreement.

## POST /api/recommend

Request:
```json
{
  "query": "Я возле EXPO, хочу прогуляться 60 минут",
  "lat": 51.089,
  "lon": 71.416,
  "max_minutes": 60,
  "language": "ru",
  "mode": "walk",
  "preferences": ["architecture", "coffee"]
}
```

Required request fields: `query` (1-500 chars), `lat` (-90..90), `lon` (-180..180), `max_minutes` (15..240), `language` (`ru`, `kk`, `en`). Optional fields: `mode` (`walk`, `general`, default `walk`), `preferences` (array of strings, default []).

Response:
```json
{
  "recommendations": [
    {
      "id": "node/EXAMPLE_ID",
      "name": "Name from real collected POI dataset",
      "category": "cafe",
      "lat": 51.089,
      "lon": 71.416,
      "distance_m": 350,
      "reason": "Match with the stated interest in coffee",
      "visit_minutes": 25,
      "activity": "Visit the café and take a break",
      "opening_hours": null,
      "source": "OpenStreetMap",
      "source_url": "https://www.openstreetmap.org/node/EXAMPLE_ID",
      "facts": ["amenity=cafe"],
      "walk_minutes": null,
      "walk_time_source": null,
      "availability_status": "unknown"
    }
  ],
  "route": {
    "ordered_poi_ids": ["node/EXAMPLE_ID"],
    "geometry": null,
    "route_minutes": null,
    "is_approximate": true
  },
  "data_updated_at": "2026-10-19T00:00:00Z",
  "warnings": ["Walking time and opening hours were not independently verified"],
  "retrieval_debug": null
}
```

The JSON above is an illustrative schema. `EXAMPLE_ID` is not an actual OSM identifier or a fabricated listing; live demo MUST contain genuine collected POIs. The example date/time is illustrative, not a fresh data assertion.

Rules:
- `recommendations` must contain 0–3 places, never an invented POI. Empty results are valid and should have an actionable warning.
- Required recommendation fields are `id`, `name`, `category`, `lat`, `lon`, `distance_m`, `reason`, `visit_minutes`, `activity`, `opening_hours`, `source`.
- Optional recommendation fields are `source_url`, `facts` (strings tied to OSM data), `walk_minutes`, `walk_time_source`, `availability_status`.
- `distance_m` is Haversine straight-line distance; label it as approximate straight-line distance in UI.
- `walk_minutes` must be null unless backed by a suitable walking-routing provider. Avoid simple speed conversions masquerading as exact ETA.
- `availability_status` is `verified_open`, `verified_closed`, or `unknown`. Return `unknown` if parsed hours/timezone are absent or ambiguous.
- `route` is nullable; coordinates on the map may be connected visually but without implying streets/walking distances when `is_approximate=true`.
- `retrieval_debug` is nullable, optionally a non-sensitive explanation like category matches and source tags (not hidden model reasoning).
- No HTTP 500 merely because Gemini API fails: fallback generates deterministic summaries from real POIs.

## GET /api/pois
Returns an array of normalized POI objects. Pagination (`limit`, `offset`) optional. Always include `id`, `name`, `category`, `lat`, `lon`, `source_url`. Can return opening_hours, tags, description, updated_at.

## GET /api/health
```json
{"status":"ok","poi_count":0,"llm_enabled":false,"dataset_updated_at":null}
```

## Error contract
- 422: invalid coordinates, empty query, out-of-range duration.
- 200 + empty recommendations + warnings for no match.
- 503 only if entire backend dataset and fallback are unavailable.

## Dev env
- Backend `http://localhost:8000`, FastAPI Swagger `http://localhost:8000/docs`.
- Frontend `http://localhost:5173`, `VITE_API_BASE_URL=http://localhost:8000`.
- Never expose `GEMINI_API_KEY` to browser.

## Quality rules
- If condition “quiet, outlets, wheelchair, paid/free, events today” is not substantiated by source data, do not assert it as fact.
- `facts` display provenance; `reason` and `activity` are AI-generated suggestions grounded in source data. Differentiate these.
- Weather provider, if enabled, is another cited factual source; only show current/forecast conditions returned by the API with timestamps.
