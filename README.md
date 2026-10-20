# QalaGo AI

An AI city guide for Astana. Say what you want, such as "Хочу кофе", "I want to walk in a park" or "I have two hours and want coffee and a walk". QalaGo finds **real places in 2GIS**, builds **2GIS routes** to them, and shows up to three ranked options on a 2GIS map. **Another route** brings up options you haven't seen yet. Sign-in with Google is optional. Built for Case 1 of the Build with AI hackathon.

| Part | Stack | Docs |
|---|---|---|
| `frontend/` | React 19, TypeScript, Tailwind 4, 2GIS MapGL, Google Identity Services, Playwright | [frontend/README.md](frontend/README.md) |
| `backend/` | FastAPI, 2GIS Places/Geocoder/Routing, optional Gemini, SQLite accounts | [backend/README.md](backend/README.md) |
| API | `/api/plan`, auth, geocoding | [docs/API_V2.md](docs/API_V2.md) |
| Deployment | Docker Compose (nginx + API), HTTPS, Google and 2GIS setup | [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) |

## Quick start (local)

```sh
# backend (Python 3.12)
cd backend
python -m venv .venv && .venv/bin/pip install -r requirements.lock.txt
cp .env.example .env            # TWOGIS_API_KEY, TWOGIS_MAP_KEY, optionally GOOGLE_CLIENT_ID
.venv/bin/python -m app         # http://127.0.0.1:8000

# frontend (Node 20+), in another terminal
cd frontend
npm ci
npm run dev                     # http://localhost:5173, proxies /api to the backend
```

On Windows use `.venv\Scripts\python.exe` instead of `.venv/bin/python`.

## Production (Docker)

```sh
cp .env.example .env            # fill in keys and your public origin
docker compose up -d --build    # UI + API on http://127.0.0.1:8080; put HTTPS in front
```

See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for HTTPS, the Google OAuth client, 2GIS key restrictions, health checks and troubleshooting.

## How it works

1. **Intent.** Deterministic ru/kk/en rules map the request to categories (coffee, food, park, museum, study, sights, kids), a named place, and constraints (time, travel mode, open now, price, accessibility). Gemini is used only if the rules find nothing, and only within the same category list. Vague requests get one short clarifying question.
2. **Places.** The 2GIS Places API is searched around the origin. Results are kept only when their 2GIS rubric confirms the category.
3. **Routes.** 2GIS Routing (walking, car, bike) or the Public Transport API. Combined requests ("coffee and a walk") become multi-stop routes, with stops ordered nearest first.
4. **Ranking.** A transparent score: match 40%, travel time 30%, 2GIS rating 15%, opening hours and constraints 15%. Every option explains itself with sourced facts.
5. **Another route.** The browser keeps a bounded list of shown route signatures (stop IDs plus transport mode) and sends it back, so repeats are impossible. When nothing new remains, the app says so and offers next steps.

Nothing is invented. Places, hours, ratings, prices and routes come only from 2GIS, and unknown values are shown as unknown. Limits and privacy are covered in [docs/limitations.md](docs/limitations.md).

## Data and attribution

Places, routes and map © 2GIS. The legacy `/api/recommend` endpoint still serves the bundled OpenStreetMap snapshot (© OpenStreetMap contributors, ODbL); see [docs/API_CONTRACT.md](docs/API_CONTRACT.md).
