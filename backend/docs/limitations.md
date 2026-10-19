# Current limitations

- POIs are real OSM records, not a guarantee of full Astana coverage, current operation, admission or safety. The collection timestamp is import time; OSM's database timestamp does not prove every individual venue was recently checked.
- Ways/relations use bounding-box centres. Their positions can be outside the feature; never navigate to them as verified entrances.
- No validated walking router, weather feed, live events, ratings, accessibility audit, price database or opening-hours parser. Availability stays unknown; walking time/route stay null.
- Up to three sourced visit options are returned with capped visit durations. Walking/airport/check-in time is unknown. No promise that a multi-stop itinerary fits the total wall-clock budget. P1 itinerary/weather/routing/embedding features were deferred.
- Synonyms cover common ru/kk/en intents, not full natural-language understanding. Negation and complex accessibility constraints are not hard-filtered; source facts and uncertainty remain visible. Server radius is configurable; the frozen POST contract has no radius field.
- TF-IDF has deterministic lexical relevance; it cannot establish venue qualities missing from tags. Category diversity is a ranking heuristic, not a route optimizer.
- Gemini chooses grounded IDs/evidence and activity codes. Audited templates limit factual fabrication but also limit fluent personalized narratives. After a key was supplied, live transport/schema/model settings were checked and updated; the provider returned HTTP 503 (high demand). Successful live generation remains unverified; SDK request/response handling and fallback are tested with mocked HTTP.
- Dataset refresh is a separate CLI task and requires an API restart. JSON is canonical; a crash between index and JSON replacement can require an automatic index rebuild at next startup.
- No public deployment, authentication, distributed rate limiting or load benchmark is included. Use an appropriately configured HTTPS gateway/rate limiter for public traffic. Do not continuously harvest from community Overpass infrastructure.
