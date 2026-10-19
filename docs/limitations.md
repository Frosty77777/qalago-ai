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
- Walking times and route lines come from the **2GIS Routing API** (pedestrian) when `TWOGIS_API_KEY` is set on the backend. Stops are ordered nearest-first (greedy, not an optimal tour), the return trip is not included, and trailing stops that would overrun the time budget are dropped. Without the key, or if 2GIS fails, the app falls back to unrouted visit options, and the UI reads "Walking time not estimated".
- With routing, the time budget counts 2GIS walking minutes plus visit minutes. Without routing it counts visit minutes only, and users are told to leave a margin for travel. Airport travel and check-in are never included (T04).
- Card distances stay straight-line even when routed; the walking time next to them is the 2GIS figure.

## AI-generated text
- `reason` and `activity` are generated suggestions, grounded in retrieved POIs and marked "AI suggestion". Source facts appear in a separate "Source data" block.
- *(Backend)* Gemini sees only retrieved POIs, and returned IDs are whitelisted. Names and coordinates always come from the database. If Gemini fails, a deterministic fallback is used. → Participant A: link the tests that prove this.
- The "Why these places?" panel shows server retrieval details, never hidden model reasoning.

## Demo data
- The frontend ships one isolated demo dataset, a real OSM snapshot from 2026-10-19 with template texts. It is used only on explicit request (`VITE_USE_MOCKS=true` or a button on the error screen) and is always badged **Demo data**. It doesn't parse opening hours and doesn't estimate walking time.

## Privacy
- Geolocation is requested only when the user clicks **Use my location**. Clicking the map and the three area presets work without it.
- Coordinates are sent with the recommendation request only (rounded to 5 decimals, about 1 m). The frontend never stores them. Only the UI language is kept in `localStorage`.
- With routing enabled, the backend sends the origin **rounded to 4 decimals (about 11 m)** and the stop coordinates to 2GIS to compute walking routes. Gemini still never receives coordinates. The 2GIS key stays server-side in `backend/.env`.
- Share links contain the query, duration, mode, language and a *preset* area ID, never coordinates.
- No API keys exist in the frontend. Gemini is called server-side only.
- *(Backend)* No coordinates or full query text in server logs. → Participant A to confirm.

## Not built (honest scope)
- No live weather, user accounts, reviews or photos. Routing is pedestrian only and needs a 2GIS key.
- No offline maps or tile caching.
- Business model and partnerships are ideas only. There is no traction or partner agreement.
