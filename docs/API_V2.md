# QalaGo API v2: discovery, routing and accounts

All endpoints are under `/api` on the same origin as the UI. Errors from 2GIS or auth come back as
`{"error": {"kind": "...", "service": "..."}}`. The legacy OSM endpoints (`/api/recommend`, `/api/pois`) are described in [API_CONTRACT.md](API_CONTRACT.md).

## `POST /api/plan`

```json
{
  "query": "Хочу кофе",
  "lat": 51.0928, "lon": 71.4215,
  "max_minutes": 60,
  "language": "ru",
  "transport": "walking",
  "categories": [],
  "seen": [],
  "exclude": [],
  "radius_level": 0
}
```

| Field | Notes |
|---|---|
| `query` | 1–500 characters, ru/kk/en. Time ("2 часа", "two hours") and travel mode ("на машине") stated in the text override the form values. |
| `transport` | `walking`, `driving`, `bicycle`, `public_transport`. |
| `categories` | The answer to a clarifying question (`coffee`, `food`, `park`, `museum`, `study`, `sights`, `kids`); replaces the parsed categories. |
| `seen` | Up to 60 route signatures already shown in this exploration. None of them is returned. |
| `exclude` | Up to 5 signatures that must not be returned (the route on screen when "Another route" was pressed). |
| `radius_level` | 0–2: widens the search area by ×1, ×1.6, ×2.5. |

Response `status`:

- `ok`: 1–3 `options`, ranked.
- `clarify`: `question` and `choices`. The request was too vague to search usefully.
- `empty`: nothing suitable could be found and routed. `suggestions` lists next steps.
- `exhausted`: real matches exist, but every combination was already in `seen`/`exclude`.
- `routing_unavailable`: 2GIS routing failed (quota, key, outage). `places` holds up to 3 real places with straight-line distance only, and `routing_error` says why.

Each option carries:

- `id`: the route signature, `sha256(transport | ordered stop IDs)[:16]`. An alternative path to the same stop also includes a coarse geometry fingerprint.
- `title`, `transport`, `stops[]`, `travel_minutes`, `travel_distance_m` (from 2GIS).
- `visit_minutes`: an assumed time per stop, labelled as an estimate.
- `total_minutes`: travel plus visits, without the return trip.
- `geometry`: a GeoJSON LineString from 2GIS.
- `explanation[]`: one sentence per evidence item, each naming its source.
- `badges`: `fastest` / `top_rated`, relative to the options shown.
- `score`: the score components.

Each stop carries 2GIS facts only:

- `rubric`, `address`, `rating` and `review_count`.
- `hours_status`: `open`, `closes_soon` or `unknown`, from the 2GIS weekly schedule at the estimated arrival time.
- `average_check`, `accessibility`, `laptop_friendly`: 2GIS attribute labels, or null.
- `source_url`: the place's 2GIS page.

### Ranking

`total = 0.40·relevance + 0.30·travel + 0.15·quality + 0.15·constraints`

- **relevance**: 1.0 if the primary 2GIS rubric matches the intent, 0.8 for a secondary rubric or an attribute match (for example "Можно с ноутбуком" for study), 1.0→0.5 by 2GIS rank for a named place.
- **travel**: `1 − travel_minutes / budget`.
- **quality**: `rating / 5` with at least 5 reviews; otherwise 0.5 (neutral).
- **constraints**: open on arrival 1, closes during the visit 0.3, unknown 0.5. When requested, accessibility and price are 1 with 2GIS evidence and 0.5 when unknown.

Hard filters:

- Places 2GIS lists as closed when you'd arrive.
- An average check above 3000 ₸ when "cheap" was asked for.
- Results whose rubric doesn't match the category (for example a bar named "Bibliotheca").
- Options whose travel time plus at least 5 minutes per stop exceeds the budget.

Unknown data is never treated as a pass.

Calls: one or two 2GIS Places searches per category, then the best 3 combinations are routed (one leg per stop). Further combinations are routed only to replace ones that fail.

## `GET /api/geocode?q=&lat=&lon=&language=`

Returns a list of `{name, lat, lon}` (up to 5) from the 2GIS Geocoder, used for a manual origin.

## `GET /api/reverse-geocode?lat=&lon=&language=`

Returns `{name}`, a label for a point picked on the map.

## `GET /api/config`

Returns `{twogis_map_key, google_client_id, places_enabled}`. Both values are public identifiers.

## Auth

| Endpoint | Behaviour |
|---|---|
| `POST /api/auth/google` `{credential}` | Verifies the Google ID token on the server; creates the account on first sign-in; sets the session cookie. Requires a trusted `Origin`. Errors: `401 invalid_token`, `403 untrusted_origin`, `409 account_conflict`, `503 not_configured` / `verification_unavailable`, `429`. |
| `GET /api/auth/me` | `{user, auth_enabled}`; `user` is null without a valid session. |
| `POST /api/auth/logout` | Deletes the session and clears the cookie (`204`). Requires a trusted `Origin`. |

## Status codes

| Code | `error.kind` | Meaning |
|---|---|---|
| 422 | — | Invalid request body |
| 429 | `rate_limited_local` | This app's per-client limit (`Retry-After` header) |
| 502 | `key_rejected`, `bad_response`, `no_route` | 2GIS refused the key or answered unexpectedly |
| 503 | `not_configured`, `unavailable`, `rate_limited` | Key missing, 2GIS unreachable or 2GIS quota (`Retry-After: 30`) |
