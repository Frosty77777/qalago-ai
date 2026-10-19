# QalaGo AI — 27-hour hackathon execution kit

## Goal
Build an evidence-grounded, location-aware city guide for Astana with automated OpenStreetMap POI harvesting, retrieval-augmented generation, a map-first UX, and time-budget-aware mini-itineraries. This is Case 1 from the Build with AI hackathon brief.

## Roles
- Participant A (Codex): owns `backend/`, POI collector, retrieval, Gemini grounded generation, ranking, itineraries, API tests, privacy.
- Participant B (Claude Max): owns `frontend/`, polished map UI, state management, route visualization, i18n, interaction tests, slide deck and screen recording.
- Shared files: `docs/` and root README. Coordinate changes here by agreed ownership or PR.

## First 15 minutes
1. Create one private GitHub repository `qalago-ai` (make it public before submission if required).
2. Commit a root `.gitignore`, `README.md`, `backend/`, `frontend/`, `docs/`.
3. Both teammates read `API_CONTRACT.md`. Freeze API field names; additive fields only after both agree.
4. Open `PROMPT_CODEX_BACKEND.md` in Codex and `PROMPT_CLAUDE_FRONTEND.md` in Claude Max.
5. Each runs one smoke test: backend GET `/api/health`, frontend `npm run build`.
6. Set milestones at hour 5 (both sides run), hour 9 (end-to-end working), hour 18 (feature freeze), hour 24 (submission artifacts done).

## Priorities
- P0: real OSM collection, verifiable POIs, geographic retrieval, grounded RAG, API, map, three scenarios, robust fallback.
- P1: scored hybrid retrieval, constraint-aware mini-itineraries, three languages, weather context, uncertainty labels, evidence drawer.
- P2: save/share routes, accessibility filters if actual data exist, redesigned cards, voice input.

## Deadline policy
At hour 18, freeze new features. At hour 24, have the presentation, video, scenario document, repository, and URLs ready. Hours 24–27 are contingency and submission buffer. Reserve meaningful rest if this is an overnight deadline; reduce P2, not testing.

## Development conventions
- Never commit API secrets (`.env`, access tokens).
- Frontend should never call Gemini directly; API key stays server-side.
- Normalize and deduplicate OSM POIs; only recommend retrieved `id` values.
- Never invent opening hours, prices, reviews, accessibility, power outlets, special events, route ETA or crowds.
- Use the phrase 'distance as the crow flies' for Haversine results. Road/walking ETA needs an appropriate routing API; otherwise leave nullable.
- Display OSM attribution at all times and respect public tile usage policy.
- A Gemini outage must not stop useful search-backed recommendations.
- Do not store precise user location or arbitrary queries in server logs.

## Documents
- `API_CONTRACT.md`: frozen integration interface and examples.
- `PROMPT_CODEX_BACKEND.md`: detailed task for Participant A.
- `PROMPT_CLAUDE_FRONTEND.md`: detailed task for Participant B.
- `27H_TIMELINE.md`: shared milestones and go/no-go gates.
- `TEST_SCENARIOS.md`: demo and negative test cases.
- `PITCH_AND_SUBMISSION.md`: slides, video, Q&A, hand-in checklist.
