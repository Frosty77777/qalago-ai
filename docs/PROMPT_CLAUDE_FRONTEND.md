# COPY TO CLAUDE MAX — Participant B / Frontend + UX + Demo

You are the frontend/design lead for the 27-hour Build with AI hackathon. Build a complete working React app called **QalaGo AI** for personalized Astana exploration. Read `API_CONTRACT.md` and `27H_TIMELINE.md` before editing. Own `frontend/` and presentation artifacts. Never overwrite `backend/` or change required API field names without consensus.

## Stack
Vite + React + TypeScript + Tailwind CSS + React Leaflet + OpenStreetMap tiles; state management can be React hooks or TanStack Query. Avoid unnecessary UI frameworks or blocking OAuth/logins. Create `.env.example` with `VITE_API_BASE_URL=http://localhost:8000`. NEVER put Gemini credentials in frontend code.

## Product / design direction
Elegant map-first city exploration UI, readable at demo projector resolution, modern typography and high-contrast selected POIs. Astana-specific but no fabricated POI images or ratings. Desktop: side panel with search/filter/results and large map. Mobile: map with bottom sheet. Polish interaction states, not superficial animations. Source attribution always visible.

## P0 functional requirements
1. On load show an interactive map centered approximately on Astana and a helpful search panel.
2. Allow browser geolocation (explicit user click/permission), manual selection by clicking map, and a few clearly labeled demo origin areas (EXPO, Baiterek, embankment); coordinates for demo origin choices must be checked, not improvised as precise entry points.
3. Search free-text query and quick scenario chips: 30–60 min walk; quiet coffee; family activity; tourist with 2 hours; evening exploration. No claims about quiet/outlets if backend lacks evidence.
4. Duration control (15–240 minutes), language RU/KK/EN, mode presets (walk, family, friends, date, solo). Presets should alter actual query/preferences, not just visuals.
5. Typed API client: POST `/api/recommend`, GET `/api/pois`, GET `/api/health`. Follow `API_CONTRACT.md`. Provide loading, retries, empty states, offline/backend-error states. API fallback data only inside isolated `mocks/` files, with unmistakable 'Demo data' marker; NEVER silently use invented data in final live demo.
6. Cards render 1–3 real POIs: name, category, short reason, suggested activity, straight-line distance label, visit minutes, opening-hours status unknown/verified, OSM provenance link. Clicking card focuses map POI. Show origin marker and destination markers with appropriate accessible labels.
7. If multiple stops returned, render a mini-itinerary timeline. Distinguish approximate schematic connection from real pedestrian routes. Do not fabricate walking-route geometry, ETA or open hours.
8. Multi-language *interface* and localized generated content when backend supports it; ensure no untranslated core screens. Persistent language selection can use localStorage (not precise location).
9. Keyboard focus, visible buttons, adequate mobile spacing, responsive 375px width and large-screen layout. Add a privacy note that exact position is used transiently for recommendations.
10. Include visible OSM attribution consistent with OSM tile usage policy; no bulk tile prefetch or offline maps.

## P1 optional after P0
- Weather chip (provider+timestamp) integrated only after backend makes weather available.
- Map filters by category and radius.
- Route re-plan buttons: "more nature", "shorter", "indoors" that send a new real query.
- Evidence panel "Why these places?" showing tags/source vs generated suggestions, without claiming access to hidden LLM thought processes.
- Save/share generated itineraries without including precise user coordinates in URL by default.
- Skeleton loaders, polished transitions, carefully selected icons; use CSS illustrations instead of unlicensed photos.

## Tests, integration, deliverables
- TypeScript strict mode, successful `npm run build`, no runtime errors.
- At least browser smoke tests for search, map click, geolocation refused, 0 results, unavailable API, 3 languages, route selection, 375px viewport.
- Create `frontend/README.md` with PowerShell and POSIX commands and screenshots instructions.
- By hour 5 visual shell and GET POI markers, by hour 9 full POST recommendation flow, by hour 18 all features frozen.
- Use hours 21–24 to prepare project slides (5–7 min), record/upload demo to YouTube, verify slides and links. Work with Participant A on technical architecture slide.

## Suggested demo narrative
Start with user at EXPO with 60 minutes; show AI interpretation, sourced nearby POIs, map pins, reason and action. Switch to family plan, show different constraints. Switch RU/KK/EN. Show transparency for unknown hours (no fake "open now"). Reveal data collector and retrieval layer with real source URLs to judges.

Start creating actual project files now. Build against frozen API contract. Make the UI useful even before AI is available, but do not misrepresent mock data or unsupported facts. Show actual build/test results before claiming completion.
