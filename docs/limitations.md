# Limitations, ethics and privacy

Participant B wrote the frontend sections. Participant A should complete or correct the backend sections.

## Data
- **Coverage and freshness.** POIs come from OpenStreetMap, which volunteers edit. Places can be missing, misnamed, closed or out of date. Each result shows its OSM link and the dataset timestamp.
- **Centroids, not entrances.** Area and building coordinates are Overpass `center` points. Map pins and demo origins mark the *area*, not a door or entrance.
- **Opening hours.** Many places have no `opening_hours` tag. The UI shows "Hours not verified" unless the backend explicitly returns `verified_open` or `verified_closed`.
- **Attributes we can't verify.** Quietness, power outlets, prices, ratings, crowds, events and accessibility are usually absent from OSM. The app never states them unless a source tag supports it, and quiet/outlet requests show an explicit notice.
- **Licensing.** OSM data is under ODbL and requires attribution, which stays visible on the map at all times. Tiles come from the OSMF servers, which are meant for low-volume interactive use. A production launch would need its own tile provider.

## Distances and time
- `distance_m` is a straight-line (Haversine) distance. The UI always labels it "as the crow flies".
- Walking time is shown only if the backend uses a real pedestrian-routing provider and names it. Otherwise it reads "Walking time not estimated".
- Multi-stop connections on the map are schematic dashed lines and are labelled as not being walking routes.
- The time budget counts visit minutes only. Users are told to leave a margin for travel. Airport travel and check-in are never included (T04).

## AI-generated text
- `reason` and `activity` are generated suggestions, grounded in retrieved POIs and marked "AI suggestion". Source facts appear in a separate "Source data" block.
- *(Backend)* Gemini sees only retrieved POIs, and returned IDs are whitelisted. Names and coordinates always come from the database. If Gemini fails, a deterministic fallback is used. → Participant A: link the tests that prove this.
- The "Why these places?" panel shows server retrieval details, never hidden model reasoning.

## Demo data
- The frontend ships one isolated demo dataset, a real OSM snapshot from 2026-10-19 with template texts. It is used only on explicit request (`VITE_USE_MOCKS=true` or a button on the error screen) and is always badged **Demo data**. It doesn't parse opening hours and doesn't estimate walking time.

## Privacy
- Geolocation is requested only when the user clicks **Use my location**. Clicking the map and the three area presets work without it.
- Coordinates are sent with the recommendation request only (rounded to 5 decimals, about 1 m). The frontend never stores them. Only the UI language is kept in `localStorage`.
- Share links contain the query, duration, mode, language and a *preset* area ID, never coordinates.
- No API keys exist in the frontend. Gemini is called server-side only.
- *(Backend)* No coordinates or full query text in server logs. → Participant A to confirm.

## Not built (honest scope)
- No real pedestrian routing, live weather, user accounts, reviews or photos.
- No offline maps or tile caching.
- Business model and partnerships are ideas only. There is no traction or partner agreement.
