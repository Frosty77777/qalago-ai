# Deployment and configuration

QalaGo runs as two containers. `web` is nginx: it serves the built UI and proxies `/api` to `backend`, which is FastAPI on Uvicorn. The browser only ever talks to one origin, so the session cookie stays first-party and there's no CORS in production.

```
browser ──HTTPS──▶ your TLS proxy ──HTTP──▶ web:8080 (nginx) ──/api──▶ backend:8000 (FastAPI)
                                                                         │
                                                         volume qalago-data (SQLite)
```

| Service | Image | Port | State |
|---|---|---|---|
| `web` | `frontend/Dockerfile`: Node 22 build, then `nginx-unprivileged` | 8080, published as `${HTTP_BIND}:${HTTP_PORT}` | none |
| `backend` | `backend/Dockerfile`: Python 3.12 slim, non-root uid 10001 | 8000, internal only | `/var/lib/qalago` (accounts, sessions, POI index) |

No other services are needed. SQLite holds accounts and sessions; Redis or Postgres would only be worth adding for several backend replicas (see "Scaling").

## 1. Configure

```sh
cp .env.example .env    # then fill in the values; never commit .env
```

| Variable | Secret? | Required | Purpose |
|---|---|---|---|
| `TWOGIS_API_KEY` | **yes** | yes | 2GIS Places, Geocoder, Routing and Public transport APIs (server only) |
| `TWOGIS_MAP_KEY` | no (public) | for the map | 2GIS MapGL JS key, served to the browser by `/api/config` |
| `GOOGLE_CLIENT_ID` | no (public) | for sign-in | Google OAuth Web client ID; empty hides sign-in |
| `CORS_ORIGINS` | no | yes | Exact public UI origin(s), e.g. `https://qalago.example.com`; also the CSRF `Origin` allow-list |
| `COOKIE_SECURE` | no | yes | `true` in production (cookie only over HTTPS) |
| `SESSION_TTL_DAYS` | no | no (30) | Session lifetime |
| `RATE_LIMIT_PLAN_PER_MINUTE` | no | no (30) | Per-client limit for `/api/plan`, `/api/geocode`, `/api/reverse-geocode` |
| `RATE_LIMIT_AUTH_PER_MINUTE` | no | no (10) | Per-client limit for `/api/auth/google` |
| `ROUTING_TIMEOUT_SECONDS` | no | no (8) | Timeout per 2GIS request |
| `TWOGIS_CITY_SLUG` | no | no (`astana`) | City segment in 2GIS place links |
| `GEMINI_API_KEY`, `GEMINI_MODEL` | **yes** / no | no | Optional intent fallback and the legacy `/api/recommend` |
| `LOG_LEVEL` | no | no (`INFO`) | Backend log level |
| `HTTP_BIND`, `HTTP_PORT` | no | no | Host address and port for `web` (default `127.0.0.1:8080`) |

Public keys are read **at runtime** from `/api/config`, so changing them only needs `docker compose up -d` (a backend restart), not a frontend rebuild. The frontend build has a single build-time variable, `VITE_API_BASE_URL`. Leave it empty for this same-origin setup; it must never point at a Docker-internal hostname such as `http://backend:8000`, because the browser can't resolve that.

## 2. Build and start

```sh
docker compose build
docker compose up -d
docker compose ps                 # both services should become "healthy"
curl -fsS http://127.0.0.1:8080/healthz
curl -fsS http://127.0.0.1:8080/api/health
```

Logs (one line per event; no queries, coordinates, tokens or keys are logged):

```sh
docker compose logs -f backend web
```

Graceful shutdown: `docker compose stop` sends SIGTERM. Uvicorn finishes in-flight requests (20 s budget) and Compose waits 30 s before killing the process.

Update to a new version:

```sh
git pull && docker compose up -d --build
```

## 3. HTTPS and reverse proxy

The stack listens on plain HTTP on `127.0.0.1:8080`. Put a TLS-terminating proxy in front of it, such as Caddy, nginx, Traefik or a cloud load balancer. HTTPS is required in production for three reasons:

- Browsers only allow geolocation on secure origins.
- `COOKIE_SECURE=true` cookies are only sent over HTTPS.
- Google sign-in needs an HTTPS origin outside localhost.

Minimal Caddy example:

```
qalago.example.com {
    reverse_proxy 127.0.0.1:8080
}
```

When a proxy sits in front of `web`, nginx should pass the original scheme and client address through. Replace `X-Forwarded-Proto $scheme` with `$http_x_forwarded_proto` in `frontend/nginx.conf`. Also configure `set_real_ip_from <proxy address>; real_ip_header X-Forwarded-For;` so per-client rate limits see real clients and not the proxy.

## 4. Google sign-in setup

1. Google Cloud Console → **Google Auth Platform**. Configure the consent screen (Branding and Audience). Only the default `openid email profile` scopes are used.
2. **Clients → Create client → Web application.**
3. **Authorized JavaScript origins:**
   - Production: `https://qalago.example.com`, the exact origin with no path or trailing slash.
   - Local development: `http://localhost` **and** `http://localhost:5173`.
4. **Authorized redirect URIs:** none are needed. The app uses Google Identity Services in popup/callback mode and gets an ID token in JavaScript.
5. Put the client ID in `GOOGLE_CLIENT_ID`. There's no client secret: the backend only verifies ID tokens.

How it works: the browser gets a Google ID token from the "Continue with Google" button, or from One Tap where the browser supports it (FedCM). It POSTs the token to `/api/auth/google`. The backend uses `google-auth` to verify the signature, audience (`GOOGLE_CLIENT_ID`), issuer and expiry. It finds or creates the account by the stable Google `sub`, and sets an `HttpOnly; SameSite=Lax; Path=/api` session cookie (`Secure` when `COOKIE_SECURE=true`). The database stores only a SHA-256 hash of the session token. POSTs to `/api/auth/*` must carry an `Origin` from `CORS_ORIGINS` (CSRF defence). An email that is already linked to a different Google account returns `409 account_conflict` and is never merged automatically.

## 5. 2GIS setup

Keys come from the 2GIS Platform Manager (https://platform.2gis.ru).

- **Server key (`TWOGIS_API_KEY`)** needs access to the Places API (`catalog.api.2gis.com/3.0/items`), Geocoder (`/3.0/items/geocode`), Routing API (`routing.api.2gis.com/routing/7.0.0/global`) and, for transit, the Public Transport API. The key stays on the backend. Don't expose it in the UI or in any `VITE_*` variable.
- **Map key (`TWOGIS_MAP_KEY`)** is for MapGL JS. It is visible to every visitor. Use a separate key and, if your 2GIS plan allows it, restrict it to your production domain (and `localhost` for development) in the Platform Manager.
- **Quotas.** Demo and starter keys have request limits. When routing is over its limit, the API answers `routing_unavailable` and shows the real places it found without routes. When Places is over its limit, the UI shows "too many requests". For production, get a key with enough routing quota: one search makes 1–3 Places calls and about 3 routing calls per option (more for combined stops).
- **Attribution.** MapGL draws the 2GIS logo/copyright itself. On mobile it is placed at the top so the bottom sheet can't hide it. Don't remove it. The UI also credits "Places and routes © 2GIS".
- **Caching.** No 2GIS response is cached or stored. Every search queries 2GIS live, in line with the 2GIS terms on storing directory data.

## 6. Database and migrations

Schema migrations are versioned SQL scripts in `backend/app/db.py` (`MIGRATIONS`), tracked with `PRAGMA user_version`. They run automatically at backend startup, inside a transaction. To change the schema, append a new script; never edit an applied one. Back up before upgrading:

```sh
docker compose exec backend python -c "import sqlite3; s=sqlite3.connect('/var/lib/qalago/app.sqlite3'); d=sqlite3.connect('/var/lib/qalago/backup.sqlite3'); s.backup(d)"
docker compose cp backend:/var/lib/qalago/backup.sqlite3 ./backup.sqlite3
```

## 7. Local development (no Docker)

```sh
# Terminal 1 — backend (Python 3.12)
cd backend
python -m venv .venv && .venv/bin/pip install -r requirements.lock.txt     # Windows: .venv\Scripts\python.exe -m pip ...
cp .env.example .env    # set TWOGIS_API_KEY, TWOGIS_MAP_KEY, GOOGLE_CLIENT_ID; COOKIE_SECURE=false
.venv/bin/python -m app                                                   # http://127.0.0.1:8000

# Terminal 2 — frontend (Node 20+)
cd frontend
npm ci
npm run dev                                                               # http://localhost:5173, proxies /api
```

Checks:

```sh
cd backend && .venv/bin/python -m pytest -q
cd frontend && npm run lint && npm run build && npm run test:e2e
cd frontend && npm run test:live      # real backend + real 2GIS; uses quota
```

## 8. Scaling

Rate limits are in-process and per backend worker. The image runs one Uvicorn worker, which is enough for a demo or a small deployment. For several replicas, move rate limiting to the reverse proxy or to Redis. SQLite (accounts and sessions) also assumes a single backend container; use Postgres for multiple replicas.

## 9. Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| Map panel says "isn’t configured (TWOGIS_MAP_KEY)" | Set `TWOGIS_MAP_KEY` and restart `backend`. |
| Map area blank or shows a key error from 2GIS | The map key is invalid or not allowed for this domain; check its domain restrictions. |
| "2GIS rejected the server key for place search" | `TWOGIS_API_KEY` is wrong or lacks the Places entitlement. |
| Places shown "without routes … request limit reached" | The Routing quota for the key is used up; wait or upgrade the key. |
| "Too many requests. Please wait N s" | The app's own per-client limit; tune `RATE_LIMIT_*`. |
| Google button missing | `GOOGLE_CLIENT_ID` is empty, or third-party sign-in is blocked by the browser or an extension. |
| Google popup: "origin not allowed" | Add the exact origin to Authorized JavaScript origins (step 4). |
| Sign-in returns 403 `untrusted_origin` | `CORS_ORIGINS` doesn't contain the exact UI origin, including scheme and port. |
| Signed in, but the session is lost on reload | `COOKIE_SECURE=true` over plain HTTP, or the UI and API are served from different sites. |
| `backend` unhealthy | `docker compose logs backend`; the volume `/var/lib/qalago` must be writable by uid 10001. |
