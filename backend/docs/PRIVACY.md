# QalaGo AI backend privacy policy (local hackathon build)

The API processes the map origin, free text, preferences and language to return nearby places. Origins and request text stay in memory for the request and are not written to the POI dataset, databases, request logs or analytics. SQLite stores public POI source data only. No user account or tracking cookie is created.

When GEMINI_API_KEY is configured, free text/preferences, language, requested duration and retrieved public POI source records are sent to Google's Gemini API. Raw origin coordinates are omitted, but nearby POI names can imply an approximate area. Users should avoid putting personal or confidential information in query text. Configure and disclose the relevant Google account/API data handling terms before a public launch. Disabling the key keeps recommendation processing local to this backend.

The supported launcher disables Uvicorn access logs, and the application silences request-level HTTP/SDK loggers. Application metrics contain only response status and elapsed time. It does not log URL paths/query strings, request bodies, user coordinates, full free-text prompts, API keys or SDK exception bodies. Error validation responses go only to the caller; backend request payloads are not retained. Do not enable HTTP wire/debug logging in deployment.

Browser geolocation is a frontend permission and must be requested explicitly. The frontend should offer manual map-origin selection. Public OSM harvesting uses a fixed city bbox, not a user's location, and runs separately from recommendation requests. Provider services may operate their own logs under their own policies.

Configure hosting/reverse-proxy logs to omit request bodies, query strings and location-bearing headers. Do not attach user prompts or origins to traces. Provide HTTPS and rate limits before public hosting. Any additional retention or third-party analytics changes require an updated policy and appropriate user disclosure.

Only the server `.env` may contain GEMINI_API_KEY. `.env` is ignored by git and excluded from deliverable archives. Do not put secrets in VITE_ variables, Swagger examples, source code, client bundles, screenshots or public logs.
