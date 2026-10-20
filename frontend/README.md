# QalaGo AI — frontend

A responsive, map-first web app: describe what you want, pick a starting point, compare up to three 2GIS routes, then ask for another one.

**Stack:** Vite 8, React 19, TypeScript (strict), Tailwind CSS 4, 2GIS MapGL JS (via `@2gis/mapgl`, pinned), Google Identity Services, Playwright.

## Run

Requires Node.js 20+. Start the backend first (see `../backend/README.md`).

```sh
npm ci
npm run dev            # http://localhost:5173; /api is proxied to http://127.0.0.1:8000
```

| Command | What it does |
|---|---|
| `npm run dev` | Dev server with the `/api` proxy (`QALAGO_BACKEND` overrides the target) |
| `npm run build` | Strict type-check and production build to `dist/` |
| `npm run preview` | Serve the production build (same `/api` proxy) |
| `npm run lint` | oxlint |
| `npm run test:e2e` | Playwright on desktop, Pixel 7 and iPhone SE viewports; API, MapGL and Google are stubbed |
| `npm run test:live` | Playwright against the real backend and real 2GIS (uses API quota) |

### Configuration

The UI gets the public 2GIS map key and Google client ID **at runtime** from `GET /api/config`. Nothing provider-related is baked into the bundle. The only build-time variable is `VITE_API_BASE_URL`: leave it empty for same-origin setups (dev proxy, production nginx), or set it to the backend origin for a split deployment, which also needs `CORS_ORIGINS` on the backend and cross-site cookies.

Every `VITE_*` value is public. Never put a secret there.

## Structure

| Path | Role |
|---|---|
| `src/App.tsx` | State: origin, request, results, selection, "Another route" history, mobile sheet |
| `src/components/MapView.tsx` | 2GIS MapGL: route lines (selected one highlighted), stop markers, origin, fit-to-route, resize handling |
| `src/components/RouteCard.tsx` | Route option: stops, 2GIS travel time and distance, mode, hours, rating, explanation, select button |
| `src/components/ResultsPanel.tsx` | Loading, clarify, empty, exhausted, routing-unavailable and error states |
| `src/components/SearchForm.tsx` | Query and examples, origin (location / address search / presets / map tap), time, travel mode |
| `src/components/AuthControl.tsx` | "Continue with Google" button, One Tap, account menu, sign-out |
| `src/lib/routeHistory.ts` | Bounded set of shown route signatures (30) and when a request counts as "changed" |

## Behaviour guarantees

- **Map ↔ cards.** Selecting a card highlights its line and fits it into view. Tapping another route's line or stop on the map selects that card.
- **Another route.** The request carries `seen` (bounded to 30) and `exclude` (the route on screen). The button is disabled while loading, so no duplicate requests go out. History resets when the query, origin, time, travel mode or answered category changes. When nothing new remains, the current routes stay on screen with an explanation and next steps.
- **Honesty.** Travel time and distance come from 2GIS. Time at stops is labelled an estimate. Hours, ratings and prices come only from 2GIS, otherwise "unknown". If routing is unavailable, the real places are shown "without routes" with straight-line distance only.
- **Mobile.** Bottom sheet (peek/half/full) whose handle shows the selected route. The sheet expands when the query field is focused, so the input stays above the keyboard. Touch targets are at least 40 px, there's no horizontal overflow, and the map resizes with the layout. The 2GIS copyright moves to the top so the sheet can't hide it.
- **Location.** Requested only on tap. If denied, the app explains and offers address search, presets and map taps.
- **Sign-in.** Optional. The Google ID token goes to the backend, which verifies it and sets an HttpOnly session cookie. The session is restored with `/api/auth/me`.
