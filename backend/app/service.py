from datetime import timedelta

from .config import Settings
from .grounding import Grounder, ModelChoice
from .language import MESSAGES
from .models import RecommendRequest, RecommendResponse, Recommendation, utc_now
from .retrieval import Retriever, ATTRIBUTE_TERMS, TIME_TERMS, AIRPORT_TERMS, contains, normalize_text, source_facts
from .store import POIStore

DEFAULT_VISITS = {"cafe": 20, "restaurant": 30, "park": 20, "garden": 20,
                  "museum": 30, "library": 20, "playground": 20,
                  "historic": 10, "artwork": 10, "viewpoint": 10, "attraction": 15}
DEFAULT_ACTIVITIES = {"cafe": "break", "restaurant": "break", "library": "read",
                      "park": "explore", "garden": "explore", "playground": "explore",
                      "museum": "visit", "historic": "photo", "artwork": "photo",
                      "viewpoint": "photo", "attraction": "visit"}


class RecommendationService:
    def __init__(self, store: POIStore, settings: Settings, grounder: Grounder):
        self.store, self.settings, self.grounder = store, settings, grounder
        self.retriever = Retriever(store, settings)

    async def recommend(self, request: RecommendRequest) -> RecommendResponse:
        messages = MESSAGES[request.language]
        warnings = [messages["base"]]
        updated = self.store.dataset.collected_at if self.store.dataset else None
        text = normalize_text(request.query + " " + " ".join(request.preferences))
        for key, terms in (("attributes", ATTRIBUTE_TERMS), ("hours", TIME_TERMS), ("airport", AIRPORT_TERMS)):
            if any(contains(text, normalize_text(word)) for word in terms):
                warnings.append(messages[key])
        if updated and utc_now()-updated > timedelta(days=self.settings.stale_days):
            warnings.append(messages["stale"])
        candidates = self.retriever.search(request)
        if not candidates:
            warnings.append(messages["no_results"])
            if not self.store.pois:
                warnings.append(messages["no_data"])
            return RecommendResponse(recommendations=[], data_updated_at=updated,
                                     warnings=warnings, retrieval_debug=[] if self.settings.debug else None)
        plan, model_warning = await self.grounder.choose(request, candidates)
        if model_warning:
            warnings.append(messages[model_warning])
        if plan:
            choices = plan.choices
        else:
            choices = []
            budget = request.max_minutes
            count = min(3, len(candidates), budget//5)
            for i, c in enumerate(candidates[:count]):
                minutes = min(DEFAULT_VISITS[c.poi.category], budget-5*(count-i-1))
                budget -= minutes
                choices.append(ModelChoice(poi_id=c.poi.id, visit_minutes=minutes,
                    reason_code="interest_match" if c.category_match else "nearby",
                    activity_code=DEFAULT_ACTIVITIES[c.poi.category], evidence=source_facts(c.poi)[:8]))
        selected = {c.poi.id: c for c in candidates}
        recommendations = []
        for choice in choices:
            c = selected[choice.poi_id]
            p = c.poi  # All identifying and factual fields originate in the canonical store.
            recommendations.append(Recommendation(id=p.id, name=p.name, category=p.category,
                lat=p.lat, lon=p.lon, distance_m=round(c.distance_m),
                reason=messages[choice.reason_code], activity=messages[choice.activity_code],
                visit_minutes=choice.visit_minutes, opening_hours=p.opening_hours,
                source_url=p.source_url, facts=source_facts(p)))
        warnings.append(messages["alternatives"])
        if any(selected[c.poi_id].poi.coordinate_kind == "bounding_box_center" for c in choices):
            warnings.append(messages["center"])
        debug = None
        if self.settings.debug:
            debug = [{"id": c.poi.id, "score": round(c.score, 5),
                      "text_score": round(c.text_score, 5),
                      "category_score": c.category_score,
                      "distance_score": round(c.distance_score, 5),
                      "matched_tags": source_facts(c.poi)} for c in candidates]
        # Multiple recommendations are options. No route/ETA is fabricated.
        return RecommendResponse(recommendations=recommendations, route=None,
                                 data_updated_at=updated, warnings=warnings, retrieval_debug=debug)
