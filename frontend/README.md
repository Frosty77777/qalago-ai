# QalaGo AI — frontend

Map-first React app for short, source-grounded walks in Astana. Owner: Participant B.
Talks to the backend only through the frozen contract in [`../docs/API_CONTRACT.md`](../docs/API_CONTRACT.md).

**Stack:** Vite 8, React 19, TypeScript (strict), Tailwind CSS 4, React Leaflet 5 with OpenStreetMap tiles, Playwright.

## Run

Requires Node.js 20+ (tested with Node 24). The backend should be running on `http://localhost:8000`.

PowerShell (Windows):

```powershell
cd frontend
npm install
Copy-Item .env.example .env.local
npm run dev            # http://localhost:5173
```

POSIX (macOS/Linux):

```sh
cd frontend
npm install
cp .env.example .env.local
npm run dev            # http://localhost:5173
```

| Command | What it does |
|---|---|
| `npm run dev` | Dev server on port 5173 |
| `npm run build` | Type-check (`tsc -b`, strict) and production build to `dist/` |
| `npm run preview` | Serve the production build |
| `npm run lint` | oxlint |
| `npm run test:e2e` | Playwright smoke tests (starts the dev server itself; backend is stubbed) |
| `npm run fixture` | Re-collect the demo snapshot from Overpass into `src/mocks/demoPois.json` |

### Environment

| Variable | Default | Meaning |
|---|---|---|
| `VITE_API_BASE_URL` | `http://localhost:8000` | Backend base URL |
| `VITE_USE_MOCKS` | `false` | `true` forces demo data (see below) |

Every `VITE_*` value ends up in the public JS bundle. **Never put `GEMINI_API_KEY` or any secret here**; Gemini is called only by the backend.

## Demo data (mocks)

`src/mocks/` holds the only fallback data in the app:

- `demoPois.json` is a real OpenStreetMap snapshot (58 named places around EXPO and Bayterek, collected by `scripts/fetch-demo-fixture.mjs`, with OSM IDs, source URLs and the Overpass timestamp).
- `mockApi.ts` ranks those places deterministically and fills `reason`/`activity` with templates marked `[Demo template]`. It never parses opening hours, so availability is always `unknown`, and walking time is always `null`.

Demo data is used only when `VITE_USE_MOCKS=true` or when the user clicks **Use demo data instead** on a backend error. Either way the header shows a magenta **Demo data** badge and an explanation banner. The app never switches silently.

## What the UI guarantees

- Origins: browser geolocation only after a click, a click anywhere on the map, or three checked presets (OSM centroids, verified via Overpass on 2026-10-19):
  EXPO `way/454853233`, Bayterek `way/230401645`, Esil embankment / Seruen footbridge `way/263517343`.
- Distances are always labelled "as the crow flies" (`distance_m` is Haversine).
- A green "Open now (verified)" badge appears **only** for `availability_status = verified_open`; everything else shows "Hours not verified".
- Walking time is displayed only when `walk_minutes` *and* `walk_time_source` are present.
- Multi-stop routes are drawn as a dashed schematic line labelled "not walking routes" unless the backend returns a non-approximate `route.geometry` (GeoJSON LineString), which is drawn solid.
- Source facts (`facts`, OSM hours, source link) are visually separated from generated text (`reason`, `activity`, marked "AI suggestion").
- Scenario notices: flight/airport queries warn that airport travel isn't included (T04); quiet/outlet queries warn those attributes aren't guaranteed (T02); evening queries remind that hours aren't verified (T05).
- Mode presets (walk, family, friends, date, solo) change the request's `mode` and `preferences`, not just the visuals. Re-plan buttons send real new requests.
- Share links carry the query, duration, mode, language and *preset* origin only, never coordinates.
- Language (RU/KK/EN) is stored in `localStorage`; location never is. Switching language re-runs the last request so generated text follows.
- OSM attribution is always visible (moves to the top on mobile so the bottom sheet can't cover it). No tile prefetching or offline maps.

## Tests

`tests/smoke.spec.ts` stubs the backend with `page.route` (responses built from the real snapshot) and blocks real tile requests. It covers: initial load and attribution, the full search flow and contract request body, map-click origin, geolocation declined, 0 results, backend unreachable plus the explicit demo switch, 422 details, all three languages plus persistence, scenario notices and mode preferences, verified-open badge logic, re-plan requests, share-link privacy, and the 375 px mobile layout.

The tests use the locally installed Google Chrome (`channel: 'chrome'`). For bundled Chromium instead:

```sh
npx playwright install chromium
PW_CHANNEL= npm run test:e2e          # POSIX
$env:PW_CHANNEL=''; npm run test:e2e  # PowerShell
```

## Screenshots for slides / submission

1. Start the backend, then `npm run dev`.
2. Desktop: browser at 1440×900. Choose **EXPO area** → **30–60 min walk**, wait for the pins, then click card 2 to show the selected marker.
3. Mobile: DevTools device toolbar, 375 px wide (e.g. iPhone SE). Choose **Bayterek area** → **Family activity**, then tap **Show on map**.
4. Repeat one view in Қазақша and Русский for the multilingual slide.
5. Make sure the "Demo data" badge is **not** visible when capturing live results.

## Structure

```
src/
  api/        contract types + fetch client (timeouts, retries on network/502–504, 422 details)
  mocks/      demo snapshot + deterministic demo recommender (isolated, always labelled)
  i18n/       ru/kk/en strings, category names, provider
  lib/        geo (Haversine, formatting), presets (origins/scenarios/modes), share links
  components/ MapView, SearchForm, ResultsPanel, ResultCard, Itinerary
scripts/      fetch-demo-fixture.mjs (Overpass → demo snapshot)
tests/        Playwright smoke tests
```
