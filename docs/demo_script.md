# Demo video and pitch script

## Before recording (checklist)
- Backend running with the **real collected dataset**. The header pill shows the place count, and "AI: Gemini" if a key is set.
- Frontend: `npm run build && npm run preview`, or `npm run dev`. The **Demo data** badge must not be visible.
- Browser at 1440×900, zoom 100 %, bookmarks bar hidden, notifications off.
- Run all three scenarios once to warm the backend cache, then reload.
- Recorder: OBS or the Windows Game Bar (`Win+Alt+R`), 1080p, 30 fps, microphone on.
- Upload to YouTube as **Unlisted** (or Public if the rules require it). Paste the link into the submission and **test it in a private window**.

## YouTube demo (2:30 target)

| Time | On screen | Voice-over (EN; adapt for RU/KK) |
|---|---|---|
| 0:00–0:10 | App idle state, title visible | "This is QalaGo AI, a city guide for Astana that only recommends places that really exist, with a source for every one of them." |
| 0:10–0:20 | Hover the idle panel | "The problem: you have an hour near EXPO. What's actually nearby, and what fits that time?" |
| 0:20–0:50 | Click **EXPO area**, then **30–60 min walk**. Pins drop and the map fits. | "I pick EXPO and a one-hour walk. The backend retrieves real OpenStreetMap places near me, and Gemini writes a short reason and an activity, but only about the places it was given." |
| 0:50–1:10 | Click card 2, open the **Source data** block, click the OSM link | "Every card separates facts from suggestions. These are the OSM tags. This link opens the original record. The distance is straight-line, and we say so." |
| 1:10–1:20 | Point at "Hours not verified" | "No fake 'open now'. If hours can't be verified, we say so." |
| 1:20–1:40 | Click **Family activity** | "Switch to family with two hours: different constraints, so the places change to parks and playgrounds." |
| 1:40–1:55 | Point at the "Visit options" time bar | "The options fit into the time budget: visits add up to under 60 minutes. We don't draw fake walking routes or invent ETAs." |
| 1:55–2:10 | Language **Қазақша**, then **Русский** | "Kazakh, Russian, English. The same real places, explained in your language." |
| 2:10–2:25 | Terminal: run the collector, then show the `/docs` Swagger response | "Data is collected automatically from Overpass, deduplicated, and served with source URLs and timestamps." *(Participant A)* |
| 2:25–2:30 | README / GitHub URL | "QalaGo AI. Code, tests and limitations are on GitHub." |

## Live pitch (Participant B parts, about 3 min)

**Slide 1, Title (35 s).** "QalaGo AI turns 'I have an hour near EXPO' into one to three real, sourced places on a map, with something to do at each."

**Slide 2, Problem (45 s).** "Generic chatbots invent cafés, opening hours and walking times. Map apps list hundreds of pins but don't plan around your time or who you're with. Visitors and residents need a short, trustworthy plan for the next hour or two."

**Slide 3, Demo (85 s, with A).** Follow the video steps 0:20–1:55 live. If the network fails, switch to the recorded video. Don't switch to demo data without saying so.

**Slide 5, Differentiation (55 s).**
- A time budget instead of a list: suggested visits fit your minutes.
- Facts and suggestions are kept visibly separate, and every place links to its OSM source.
- Honest uncertainty: unverified hours, straight-line distance, schematic routes.
- Kazakh, Russian and English throughout.
- Privacy: location only on click, never stored, never in share links.

**Slide 7, Value and roadmap (with A, 55 s).** Users: visitors, residents with an hour to spare, families. A possible city or tourism-office pilot is *an idea, not a partnership*. Next: real pedestrian routing, verified hours from additional sources, accessibility data where it exists.

## Q&A quick answers (frontend)
- *"Can the map show something the backend didn't return?"* No. Cards and pins render only the records in the response. Background dots are the collected dataset from `/api/pois`.
- *"What if the backend is down during the demo?"* The UI shows an error with retry. Demo data is an explicit, badged switch built from a real OSM snapshot.
- *"Is location stored?"* No. It goes only into the request body. Only the UI language is saved locally.
