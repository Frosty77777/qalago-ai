# Pitch / deck / demo / submission

The organizer's Case 1 brief calls for product concept, interactive demo, high-level RAG method, test cases, 5–7 minute deck, privacy/ethics considerations; submit repository or archive, presentation, scenarios/limitations document, and a YouTube demo link.

## 7-slide deck for a 5–7 minute pitch
| Slide | Approx. talk | Content | Responsible |
|---|---:|---|---|
| 1. QalaGo AI | 35s | One sentence value proposition and screenshot | B |
| 2. Problem | 45s | Choosing a nearby walk constrained by time, preferences, and real place availability | B |
| 3. Product demo | 85s | EXPO -> preferences -> recommended sourced places on map -> activity and mini-route | B + A |
| 4. How RAG works | 65s | Overpass collection -> normalize -> geofilter -> semantic/lexical retrieval -> grounded Gemini -> ID validation | A |
| 5. Differentiation | 55s | Time budget mini-itinerary, multilingual, weather if real, evidence/uncertainty, privacy | B |
| 6. Reliability & testing | 60s | Three scenarios, negative cases, fallback on missing model data, no fake opening hours | A |
| 7. Value, limitations, roadmap | 55s | Target users, optional B2B city/tourism application, POI freshness and licensing caveats, next steps | Both |

Approximate total 6m 40s; adjust pacing while practicing.

## 2–3 min YouTube demo structure
1. Show title and 10-sec problem.
2. Input current/demo location near EXPO, 60-min intent; show results from real POI set.
3. Expand provenance and explain one source tag; open map pin.
4. Switch to family scenario and compare changes.
5. Switch language; show route visual and explicit uncertainty on hours.
6. Briefly show automated collector script and API response.
7. Finish with GitHub URL/project name and limitations.

## Q&A prep
- "Is this real RAG?" Show an actual POI dataset, retrieval candidates, evidence fields, Gemini grounded only on retrieved IDs, and validation/fallback.
- "How do you source data?" Re-runnable Overpass collector and OSM URLs, data timestamp, deduplication.
- "What is unique?" Constraint-aware micro-itinerary with time budget and fact-generation separation.
- "How do you prevent hallucination?" ID whitelist, Pydantic validation, source fields, null/unknown hours, deterministic fallback.
- "What about location privacy?" Optional permission, map origin alternative, no durable server-side coordinates or query logging.
- "What about feasibility and monetization?" City/tourist usage; partnerships could be explored later but are not implemented. Never claim business traction without evidence.
- "How accurate is walking time?" Null unless genuine pedestrian-routing API; straight-line distance clearly labeled; time budgeting conservative.

## Submission checklist
- [ ] GitHub repository available with README and license/attribution.
- [ ] Frontend and backend startup instructions tested on fresh machine.
- [ ] Data collection command and sample real provenance records present.
- [ ] API key absent from git history and frontend bundle.
- [ ] `docs/test_scenarios.md` and `docs/limitations.md` included.
- [ ] Slides PDF/PPTX, at least 5–7 minute presentation ready.
- [ ] YouTube video uploaded and link visible to judges.
- [ ] 3 scenarios and fallback demo work without edits.
- [ ] Correct OSM attribution and no fake venue/time/rating claims.
- [ ] Submit links early, verify in incognito/private browsing.
