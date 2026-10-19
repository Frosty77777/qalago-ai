# Participant B integration handoff — frozen v1

Backend: `http://localhost:8000`. Swagger: `http://localhost:8000/docs`.
Frontend: `http://localhost:5173`; set `VITE_API_BASE_URL=http://localhost:8000`.
No shared contract fields were renamed or added. Never expose GEMINI_API_KEY to Vite.

```http
POST /api/recommend
Content-Type: application/json

{"query":"Я возле EXPO, хочу прогуляться 60 минут","lat":51.089,"lon":71.416,"max_minutes":60,"language":"ru","mode":"walk","preferences":["architecture","coffee"]}
```

`GET /api/pois?limit=1000&offset=0` returns an **array**, not an envelope. Paginate to exhaustion (max page size 5000). `GET /api/health` returns:

```json
{"status":"ok","poi_count":0,"llm_enabled":false,"dataset_updated_at":null}
```

This exact health response is valid before collection. It does not assert a successful import or model call. `llm_enabled` means a server key is configured, not that the provider is reachable.

Before OSM collection, POST returns HTTP 200 with this shape (warnings localized):

```json
{"recommendations":[],"route":null,"data_updated_at":null,"warnings":["OSM data has not been collected or is unavailable. Run the collector and restart the backend."],"retrieval_debug":null}
```

After collection, recommendation objects contain every required contract field plus the already documented `source_url`, `facts`, `walk_minutes`, `walk_time_source`, `availability_status`.

- `distance_m`: approximate **straight-line** metres; never label walking distance.
- `walk_minutes`, `walk_time_source`, and `route`: null in this P0 implementation. Cards are visit **options**, not an optimized itinerary. Sum of visit durations is capped at max_minutes; travel remains unknown.
- `availability_status`: always `unknown`; show raw `opening_hours` as unverified OSM source data, without an open-now badge.
- A way/relation pin is a bounding-box centre, potentially outside the polygon. Never call it an entrance.
- Display warnings, source link, and `data_updated_at`. `facts` are source tags; reason/activity are suggestions.
- Empty array: show an empty state, allow moving the origin/changing category. No fallback pins.
- Gemini absent/quota/timeout: HTTP 200 with deterministic real POIs and a localized warning.
- 422: invalid request. Do not send `radius`, `limit`, timestamps, or other unagreed fields in POST. Radius is a server setting.
- Allowed languages: ru/kk/en. Defaults: mode=walk, preferences=[]. All other request fields are required.

Privacy: the API does not persist user locations or prompts. When Gemini is configured, free text/preferences and retrieved POI source fields go to Google; origin coordinates do not. See PRIVACY.md.

Start and collection commands are in ../README.md. Keep the API running after real collection and restart it once to load the new snapshot.
