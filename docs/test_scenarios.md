# Test scenarios and evaluation dashboard

The scenarios come from [`kit_test_cases.md`](kit_test_cases.md), which also lists what must *not* happen. All POI names in live results must come from collected OSM data. Test origins were checked against OSM (Overpass, 2026-10-19).

**Status key:** ✅ pass with evidence · ⏳ pending · — not applicable to that layer.
Frontend evidence comes from `frontend/tests/smoke.spec.ts`, which stubs the backend with responses built from real OSM records. Backend and live end-to-end columns must be filled in once the backend is integrated. **Do not mark them as passing before then.**

| ID | Scenario | Frontend (UI behaviour) | Backend (Participant A) | Live end-to-end |
|---|---|---|---|---|
| T01 | Near EXPO, 30–60 min walk | ✅ `search flow…`: EXPO preset sends `lat 51.09279 / lon 71.42148`, 3 cards + pins, "as the crow flies" labels, no walking ETA | ⏳ | ⏳ |
| T02 | Quiet coffee with outlets | ✅ `scenario notices…`: "quietness/outlets not guaranteed" notice shown | ⏳ no unsourced quiet/outlet claims | ⏳ |
| T03 | Family with child, 2h | ✅ `scenario notices…`: family preset sends `family`, `playground` preferences and 120 min | ⏳ ranking | ⏳ |
| T04 | Tourist, 2h before flight | ✅ `scenario notices…`: airport travel/check-in "not included, no guarantee" notice | ⏳ | ⏳ |
| T05 | Evening request | ✅ evening notice; open badge only for `verified_open` (see T11) | ⏳ timezone-aware hours | ⏳ |
| T06 | Language ru/kk/en | ✅ `three languages…`: UI switches, request re-sent with new `language`, scenario query translated, choice persists after reload | ⏳ localized output | ⏳ |
| T07 | Geolocation declined | ✅ `declined geolocation…`: guidance shown, presets work; `clicking the map…`: manual origin works | — | ⏳ |
| T08 | No match | ✅ `empty result…`: empty state, backend warning shown, "Allow more time" re-queries with 120 min | ⏳ 200 + empty + warning | ⏳ |
| T09 | Gemini failure | ✅ UI renders the deterministic fallback like any 200 response; header shows "AI fallback mode" when `llm_enabled=false` | ⏳ | ⏳ |
| T10 | Overpass unavailable | ✅ `data_updated_at` shown under the results | ⏳ cached dataset | ⏳ |
| T11 | Venue without hours | ✅ `only verified_open…`: exactly one "Open now (verified)", the others "Hours not verified" | ⏳ | ⏳ |
| T12 | Accessibility request | ✅ UI shows only `facts` tags returned by the backend; it adds no accessibility claims of its own | ⏳ | ⏳ |
| T13 | Prompt injection | ✅ UI renders only returned records; it never builds POIs from the query text | ⏳ ID whitelist | ⏳ |
| T14 | Multiple stops | ✅ `search flow…`: itinerary in route order, visit-minute total vs budget, "not walking routes" schematic note | ⏳ | ⏳ |
| T15 | Narrow phone viewport | ✅ `mobile 375px…`: bottom sheet, controls reachable, no horizontal scroll, "Show on map" collapses the sheet and highlights the pin | — | ⏳ |
| T16 | Privacy | ✅ `share link…`: no coordinates in share URL; no secrets in frontend env; location is never stored in localStorage | ⏳ no coordinates in logs | ⏳ |

Error-state coverage (frontend): `unavailable API…` (unreachable backend, retry, explicit demo switch with badge) and `422 validation…` (field-level server messages).

## How to reproduce

```sh
cd frontend
npm run build       # strict type-check + production build
npm run lint
npm run test:e2e    # 13 Playwright tests
```

## Demo-ready benchmark checklist (live, before recording)

- [ ] EXPO → 30–60 min walk returns 1–3 real POIs with source links
- [ ] Family scenario returns different, family-appropriate places
- [ ] RU → KK → EN switch keeps the same POIs, with text in the new language
- [ ] No "Open now" badge without verified hours
- [ ] Stop the Gemini key, run again: fallback results still appear (HTTP 200)
- [ ] Same three cases run back to back without a reload or manual reset
- [ ] "Demo data" badge is **not** visible
