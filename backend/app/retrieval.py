from dataclasses import dataclass
import re
import unicodedata

import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer

from .config import Settings
from .geo import haversine_m
from .models import POI, RecommendRequest
from .store import POIStore

# Intent expansion only; a synonym never establishes an attribute of a POI.
SYNONYMS = {
    "cafe": ("cafe", "café", "coffee", "кафе", "кофе", "кофей", "кофехана", "кофе ішу"),
    "restaurant": ("restaurant", "food", "eat", "ресторан", "поесть", "тамақ", "мейрамхана"),
    "park": ("park", "парк", "саябақ", "green space", "природ", "табиғат"),
    "garden": ("garden", "ботанич", "сад", "бақ", "botanical"),
    "museum": ("museum", "музей", "мұражай"),
    "playground": ("playground", "детск", "бала", "kids", "children"),
    "library": ("library", "библиотек", "кітапхана", "reading", "читать", "кітап оқу"),
    "historic": ("history", "historic", "памятник", "монумент", "истори", "тарих", "ескерткіш"),
    "artwork": ("artwork", "sculpture", "скульптур", "мүсін", "өнер"),
    "viewpoint": ("viewpoint", "смотров", "панорам", "көрініс", "sunset", "закат"),
    "attraction": ("attraction", "sightseeing", "достопримеч", "көрікті", "architecture", "архитектур", "сәулет"),
}
GENERIC = ("walk", "walking", "nearby", "прогул", "прогуля", "рядом", "серуен", "жақын", "near me", "explore")
FAMILY = ("family", "семь", "семей", "отбасы", "ребен", "ребён", "child", "баламен")
ATTRIBUTE_TERMS = ("quiet", "тих", "тыныш", "outlet", "розет", "socket", "шу", "арзан", "дешев", "price", "free", "бесплат", "тегін", "wheelchair", "инвалид", "арб", "rating", "рейтинг", "event", "событи", "іс-шара")
TIME_TERMS = ("open", "открыт", "ашық", "night", "evening", "вечер", "ноч", "кеш", "түн")
AIRPORT_TERMS = ("flight", "airport", "самолет", "самолёт", "аэропорт", "рейс", "әуежай", "ұшақ")
SAFE_FACT_KEYS = ("tourism", "leisure", "amenity", "historic", "opening_hours", "wheelchair", "fee", "indoor", "outdoor_seating", "internet_access")


def normalize_text(text: str) -> str:
    return " ".join(unicodedata.normalize("NFKC", text).casefold().replace("ё", "е").split())


def contains(text: str, term: str) -> bool:
    # Bound ASCII words so 'cafe' does not match 'cafeteria'; Cyrillic stems are intentional.
    return bool(re.search(r"\b" + re.escape(term) + (r"\b" if term.isascii() else ""), text))


def intents(request: RecommendRequest) -> tuple[set[str], str, bool]:
    text = normalize_text(request.query + " " + " ".join(request.preferences))
    categories = {category for category, words in SYNONYMS.items() if any(contains(text, normalize_text(w)) for w in words)}
    if any(contains(text, normalize_text(w)) for w in FAMILY):
        categories |= {"park", "playground", "museum", "garden"}
    expanded = text + " " + " ".join(sorted(categories))
    general = any(contains(text, w) for w in GENERIC)
    return categories, expanded, general


def source_facts(poi: POI) -> list[str]:
    # Raw source values, not independent verification of their current truth.
    return [f"{key}={poi.tags[key]}" for key in SAFE_FACT_KEYS if key in poi.tags
            and len(poi.tags[key]) <= 160 and "\n" not in poi.tags[key]]


@dataclass(frozen=True)
class Candidate:
    poi: POI
    distance_m: float
    score: float
    text_score: float
    category_score: float
    distance_score: float
    category_match: bool


class Retriever:
    def __init__(self, store: POIStore, settings: Settings):
        self.store, self.settings = store, settings
        self.row = {p.id: i for i, p in enumerate(store.pois)}
        self.vectorizer = TfidfVectorizer(analyzer="char_wb", ngram_range=(3, 5), sublinear_tf=True)
        documents = []
        for p in store.pois:
            names = " ".join(v for k, v in p.tags.items() if k == "name" or k.startswith("name:"))
            documents.append(normalize_text(f"{p.name} {names} {p.category} {' '.join(SYNONYMS[p.category])}"))
        self.matrix = self.vectorizer.fit_transform(documents) if documents else None

    def search(self, request: RecommendRequest, limit: int = 9) -> list[Candidate]:
        if self.matrix is None:
            return []
        categories, expanded, general = intents(request)
        # Geographic eligibility policy, not a speed conversion or walking ETA.
        # Short requests should not retrieve distant options across the city.
        radius = min(self.settings.radius_m, 1000 if request.max_minutes < 30 else
                     2500 if request.max_minutes < 60 else self.settings.radius_m)
        vector = self.vectorizer.transform([expanded])
        text_scores = (self.matrix @ vector.T).toarray().ravel()
        candidates = []
        for poi in self.store.near(request.lat, request.lon, radius, categories):
            # Explicit access restrictions are excluded; missing tags remain unknown.
            if poi.tags.get("access") in {"no", "private"}:
                continue
            distance = haversine_m(request.lat, request.lon, poi.lat, poi.lon)
            if distance > radius:
                continue
            text_score = float(np.clip(text_scores[self.row[poi.id]], 0, 1))
            category_match = poi.category in categories
            if not categories and not general and text_score < .12:
                continue
            ds = max(0, 1-distance/radius)
            cs = float(category_match)
            tw, cw, dw = self.settings.weights
            score = (tw*text_score + cw*cs + dw*ds) / (tw+cw+dw)
            candidates.append(Candidate(poi, distance, score, text_score, cs, ds, category_match))
        candidates.sort(key=lambda c: (-round(c.score, 10), c.distance_m, c.poi.id))
        # Collapse co-located labels, prefer category variety among similarly scored options.
        selected: list[Candidate] = []
        remaining = candidates.copy()
        while remaining and len(selected) < limit:
            remaining.sort(key=lambda c: (-(c.score - .06*sum(s.poi.category == c.poi.category for s in selected)), c.distance_m, c.poi.id))
            c = remaining.pop(0)
            if any(normalize_text(c.poi.name) == normalize_text(s.poi.name) and
                   haversine_m(c.poi.lat, c.poi.lon, s.poi.lat, s.poi.lon) < 80 for s in selected):
                continue
            selected.append(c)
        return selected
