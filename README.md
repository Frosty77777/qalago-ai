# QalaGo AI

A source-grounded, location-aware city guide for Astana. It harvests points of interest from OpenStreetMap, retrieves real places near you, and generates 1–3 recommendations and a time-budgeted mini-itinerary on a map. Built for Case 1 of the Build with AI hackathon.

| Part | Owner | Docs |
|---|---|---|
| `frontend/` (React + Leaflet map UI) | Participant B | [frontend/README.md](frontend/README.md) |
| `backend/` (FastAPI, Overpass collector, retrieval, Gemini) | Participant A | [docs/PROMPT_CODEX_BACKEND.md](docs/PROMPT_CODEX_BACKEND.md) |
| Shared contract | Both | [docs/API_CONTRACT.md](docs/API_CONTRACT.md) |

## Quick start

Backend on `http://localhost:8000`, see `backend/README.md`. Then the frontend:

```sh
cd frontend
npm install
npm run dev     # http://localhost:5173
```

No backend? `VITE_USE_MOCKS=true npm run dev` runs on a real OSM snapshot with template texts, clearly badged **Demo data**.

## Documents

- [docs/API_CONTRACT.md](docs/API_CONTRACT.md): frozen integration interface
- [docs/test_scenarios.md](docs/test_scenarios.md): T01–T16 with pass/fail evidence
- [docs/limitations.md](docs/limitations.md): known limits and ethics
- [docs/demo_script.md](docs/demo_script.md): YouTube demo storyboard and live pitch script
- [docs/27H_TIMELINE.md](docs/27H_TIMELINE.md), [docs/PITCH_AND_SUBMISSION.md](docs/PITCH_AND_SUBMISSION.md)

## Data and attribution

Map data and POIs © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), available under the Open Database License (ODbL). Map tiles come from the OpenStreetMap Foundation tile servers and are used in line with their [tile usage policy](https://operations.osmfoundation.org/policies/tiles/) (interactive viewing only, no bulk prefetching).
