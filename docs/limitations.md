# Limitations, ethics and privacy

## Data (2GIS)

- **Coverage and freshness.** Places, rubrics, schedules, ratings and attributes come from the 2GIS directory at query time. A place can be missing, mislabelled or out of date. Every place links to its 2GIS page.
- **Opening hours.** "Open on arrival" means the 2GIS weekly schedule covers the estimated arrival time in the place's time zone. Holidays and temporary closures may not be reflected. A missing schedule is shown as "Hours unknown" and never as open. Places listed as closed when you'd arrive are excluded.
- **Attributes we can't verify.** Quietness has no 2GIS data and is never claimed; a notice says so. Price uses the 2GIS "average check" attribute when present. Accessibility and "laptop-friendly" are shown only as the 2GIS attribute label. Unknown values are labelled unknown and score neutrally.
- **Category matching.** A 2GIS text hit counts only when its rubric confirms the category, so a bar named "Bibliotheca" isn't a library. Kazakh-language requests are searched in Russian rubrics, since 2GIS has no English locale for Kazakhstan, and display names come from 2GIS.

## Routes and time

- Travel time, distance and geometry come from 2GIS Routing (walking, car, bike) or the 2GIS Public Transport API. Nothing is estimated locally.
- Multi-stop routes visit stops nearest-first. This is a heuristic, not an optimal tour. The return trip isn't included.
- Time at each stop is an **assumption** (for example 20 min for coffee, 30 min for a park) and is labelled "estimate". It shrinks when the budget is tight, to at least 5 min per stop.
- The search radius comes from the time budget and travel mode (40% of the budget at a conservative speed). It sizes the search area only and is never shown as an ETA.
- Car routes use 2GIS traffic data at the time of the request. Alternative paths are offered only when 2GIS returns materially different geometry.
- If 2GIS routing is unavailable (quota, key, outage), the app shows the real places it found with straight-line distance and says routing is unavailable. It never draws a substitute line.

## AI use

- Intent parsing is rule-based and tested. Gemini, if configured, is consulted only when the rules find nothing. Its output is limited to a fixed category list, and a place name it returns must literally appear in the user's text.
- Explanations are deterministic templates filled with 2GIS facts. They are not model prose, so they stay consistent with the ranking.

## Privacy

- Geolocation is requested only when the user taps **Use my location**.
- Origin coordinates go to the backend with a search and are not stored. The backend rounds the origin to about 11 m before sending it to 2GIS Routing. The Places search sends the origin to 2GIS to search nearby. Gemini never receives coordinates.
- Server logs contain only status codes, latency and error kinds. They never contain queries, coordinates, tokens or keys, and nginx doesn't log `/api` requests.
- Accounts store the Google `sub`, plus the verified email, display name and avatar URL. Sessions are stored as SHA-256 hashes. There's no search history per user.
- Share links contain the query, time, mode, language and a preset area ID, never coordinates.

## Not built

- No offline mode; search and routing always need the network.
- No saved routes or history per account yet. Sign-in only creates and restores the account.
- Rate limits and SQLite assume a single backend instance (see DEPLOYMENT.md, "Scaling").
