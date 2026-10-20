"""Intent -> real 2GIS places -> stop combinations -> 2GIS routes -> ranked options.

Route identity
--------------
A route's signature is sha256(transport | ordered stop place IDs)[:16]. Stops are always
ordered nearest-first from the origin, so the same set of places yields the same
signature. Titles, explanations and small geometry changes never affect it.
Alternative paths to the same stops (2GIS `alternative` results) get a signature that
also covers a coarse grid fingerprint of the geometry, and are dropped unless they share
less than `SAME_PATH_OVERLAP` of their cells with the main path.

"Another route" sends the signatures already shown (`seen`) plus the one on screen
(`exclude`); none of them is returned again. When nothing unseen remains the response
is `exhausted`, with concrete next steps, instead of cycling through old routes.
"""
from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from datetime import datetime, timedelta
import hashlib
from itertools import product

from .config import Settings
from .geo import haversine_m
from .hours import status_at
from .intent import INTENTS, Intent, IntentGateway, interpret
from .models import utc_now
from .plan_language import CATEGORY, MODE, T, distance_text
from .plan_models import Interpretation, Place as PlaceOut, PlanRequest, PlanResponse, ProviderFailure, RouteOption, Score, Stop
from .providers.twogis import Place, ProviderError, RouteLeg, TwoGisClient

WEIGHTS = {"relevance": .40, "travel": .30, "quality": .15, "constraints": .15}
# Search-area policy: the share of the time budget one-way travel may use, times a
# conservative speed. It sizes the search circle only; it is never shown as an ETA.
SPEED_M_PER_MIN = {"walking": 70, "bicycle": 200, "driving": 400, "public_transport": 250}
RADIUS_LEVELS = (1.0, 1.6, 2.5)
CHEAP_MAX_CHECK = 3000
MIN_RELIABLE_REVIEWS = 5
SAME_PATH_OVERLAP = .7
# Routing calls are the scarce resource (2GIS quotas): route the best few combinations
# first and only route further ones to replace combinations that failed or did not fit.
ROUTE_BATCH = 3
MAX_ROUTE_BATCHES = 3
ACCESS_TAGS = ("wheelchair", "invalid", "pandus", "ramp", "disabled", "accessib")


def signature(transport: str, stop_ids: list[str], variant: str = "") -> str:
    raw = transport + "|" + ",".join(stop_ids) + ("|" + variant if variant else "")
    return hashlib.sha256(raw.encode()).hexdigest()[:16]


def path_cells(coordinates: list[list[float]], cell: float = .004) -> frozenset[tuple[int, int]]:
    """Coarse (~300-450 m) grid cells a path passes through; insensitive to small geometry noise."""
    return frozenset((round(lon / cell), round(lat / cell)) for lon, lat in coordinates)


def overlap(a: frozenset, b: frozenset) -> float:
    return len(a & b) / max(1, min(len(a), len(b)))


def search_radius(budget: int, transport: str, level: int) -> int:
    reach = budget * .4 * SPEED_M_PER_MIN[transport]
    return int(min(30000, max(600, min(15000, reach)) * RADIUS_LEVELS[level]))


@dataclass
class Candidate:
    place: Place
    category: str
    relevance: float
    rubric: str | None
    laptop: str | None = None
    straight_m: float = 0

    @property
    def quality(self) -> float | None:
        p = self.place
        return p.rating / 5 if p.rating is not None and p.review_count >= MIN_RELIABLE_REVIEWS else None


@dataclass
class Combo:
    stops: list[Candidate]
    pre_score: float
    sig: str


@dataclass
class Context:
    request: PlanRequest
    intent: Intent
    budget: int
    transport: str
    radius: int
    now: datetime
    notices: set[str] = field(default_factory=set)
    closed: set[str] = field(default_factory=set)
    over_budget: int = 0


def rubric_match(place: Place, fragments: tuple[str, ...]) -> tuple[float, str | None]:
    primary = (place.primary_rubric or "").lower()
    if primary and any(f in primary for f in fragments):
        return 1.0, place.primary_rubric
    for rubric in place.rubrics:
        if any(f in rubric.lower() for f in fragments):
            return .8, rubric
    return 0, None


class Planner:
    def __init__(self, settings: Settings, client: TwoGisClient | None = None,
                 intent_gateway: IntentGateway | None = None, clock=utc_now):
        self.settings = settings
        self.client = client or TwoGisClient(settings)
        self.intent_gateway = intent_gateway
        self.clock = clock
        # 2GIS keys enforce a requests-per-second quota; keep concurrent routing calls low.
        self.routing_slots = asyncio.Semaphore(3)

    async def plan(self, request: PlanRequest) -> PlanResponse:
        lang = request.language
        intent = await interpret(request.query, self.settings, self.intent_gateway, request.categories or None)
        if not intent.categories and not intent.free_text:
            return PlanResponse(status="clarify", options=[], question=T[lang]["clarify"],
                                choices=["coffee", "food", "park", "museum", "sights", "study", "kids"])
        budget = intent.duration_minutes or request.max_minutes
        transport = intent.transport or request.transport
        ctx = Context(request, intent, budget, transport, search_radius(budget, transport, request.radius_level), self.clock())
        interpretation = Interpretation(
            categories=intent.categories or ["place"], free_text=intent.free_text, transport=transport,
            transport_from_text=bool(intent.transport and intent.transport != request.transport),
            budget_minutes=budget, budget_from_text=bool(intent.duration_minutes and intent.duration_minutes != request.max_minutes),
            open_now=intent.open_now, cheap=intent.cheap, accessible=intent.accessible, quiet=intent.quiet, source=intent.source)

        candidates = await self._candidates(ctx)
        excluded = set(request.seen) | set(request.exclude)
        combos = [c for c in self._combos(ctx, candidates) if c.sig not in excluded]
        options: list[RouteOption] = []
        cursor = 0
        try:
            for _ in range(MAX_ROUTE_BATCHES):
                need = 3 - len(options)
                if need <= 0 or cursor >= len(combos):
                    break
                options += await self._route_all(ctx, combos[cursor:cursor + need], excluded)
                cursor += need
        except ProviderError as exc:
            if options or not combos:
                raise
            # Places were found but 2GIS routing failed: show the real places, no invented routes.
            return self._unrouted(ctx, interpretation, combos, exc)
        options.sort(key=lambda o: (-o.score.total, o.travel_minutes, o.id))
        options = self._badges(options[:3])

        notices = self._notices(ctx, interpretation, options)
        suggestions = []
        if request.radius_level < 2:
            suggestions.append("expand_radius")
        if budget < 240:
            suggestions.append("longer_time")
        suggestions += ["change_preferences", "change_transport"]
        base = dict(interpretation=interpretation, notices=notices, radius_m=ctx.radius, ranking_note=T[lang]["ranking"])
        if not options:
            status = "exhausted" if excluded and self._had_seen_matches(ctx, candidates, excluded) else "empty"
            return PlanResponse(status=status, options=[], suggestions=suggestions, **base)
        return PlanResponse(status="ok", options=options, suggestions=suggestions, **base)

    def _unrouted(self, ctx: Context, interpretation: Interpretation, combos: list[Combo], exc: ProviderError) -> PlanResponse:
        places: dict[str, PlaceOut] = {}
        for combo in combos:
            for c in combo.stops:
                if c.place.id in places or len(places) >= 3:
                    continue
                p = c.place
                status, closes = status_at(p.schedule, p.tz_offset_min, ctx.now)
                places[p.id] = PlaceOut(id=p.id, name=p.name, lat=p.lat, lon=p.lon, category=c.category, rubric=c.rubric,
                                        address=p.address, rating=p.rating if p.review_count else None,
                                        review_count=p.review_count, hours_status="open" if status == "open" else "unknown",
                                        closes_at=closes, source_url=p.source_url, straight_distance_m=round(c.straight_m))
        return PlanResponse(status="routing_unavailable", options=[], places=list(places.values()),
                            routing_error=ProviderFailure(kind=exc.kind, service=exc.service),
                            interpretation=interpretation, notices=[T[ctx.request.language]["n_unrouted"]],
                            radius_m=ctx.radius)

    def _had_seen_matches(self, ctx: Context, candidates: list[Candidate], excluded: set[str]) -> bool:
        """True when real matches exist but every combination of them was already shown."""
        return any(c.sig in excluded for c in self._combos(ctx, candidates))

    async def _candidates(self, ctx: Context) -> list[Candidate]:
        r, intent = ctx.request, ctx.intent
        # Category searches always use ru_KZ: rubric verification matches Russian rubric names.
        # A free-text search (a named place) keeps the user's language.
        text_locale = "kk_KZ" if r.language == "kk" else "ru_KZ"
        jobs: list[tuple[str, str, bool]] = []  # (category, query, attribute-gated)
        for cat in intent.categories:
            spec = INTENTS[cat]
            jobs += [(cat, q, False) for q in spec.queries] + [(cat, q, True) for q in spec.attribute_queries]
        if intent.free_text:
            jobs.append(("place", intent.free_text, False))
        results = await asyncio.gather(*(self.client.search_places(
            q, r.lat, r.lon, ctx.radius, text_locale if cat == "place" else "ru_KZ") for cat, q, _ in jobs),
                                       return_exceptions=True)
        errors = [e for e in results if isinstance(e, ProviderError)]
        if errors and len(errors) == len(results):
            raise errors[0]
        for e in results:
            if isinstance(e, BaseException) and not isinstance(e, ProviderError):
                raise e
        best: dict[tuple[str, str], Candidate] = {}
        for (cat, _, gated), places in zip(jobs, results):
            if isinstance(places, BaseException):
                continue
            for rank, place in enumerate(places):
                straight = haversine_m(r.lat, r.lon, place.lat, place.lon)
                if straight > ctx.radius * 1.05:
                    continue
                laptop = None
                if cat == "place":
                    relevance, rubric = max(.5, 1 - rank * .1), place.primary_rubric
                elif gated:
                    laptop = place.has_attribute(*INTENTS[cat].required_attributes)
                    if not laptop:
                        continue
                    relevance, rubric = .8, place.primary_rubric
                else:
                    relevance, rubric = rubric_match(place, INTENTS[cat].rubrics)
                    if not relevance:
                        continue  # 2GIS text hits outside the category, e.g. a bar named "Bibliotheca".
                if cat == "study" and not laptop:
                    laptop = place.has_attribute(*INTENTS[cat].required_attributes)
                if not self._constraints_ok(ctx, place):
                    continue
                key = (cat, place.id)
                if key not in best or best[key].relevance < relevance:
                    best[key] = Candidate(place, cat, relevance, rubric, laptop, straight)
        return list(best.values())

    def _constraints_ok(self, ctx: Context, place: Place) -> bool:
        if ctx.intent.cheap:
            check = place.average_check()
            if check is not None and check > CHEAP_MAX_CHECK:
                return False
        # Closed now and not opening within the hour: no point routing there.
        status, _ = status_at(place.schedule, place.tz_offset_min, ctx.now)
        later, _ = status_at(place.schedule, place.tz_offset_min, ctx.now + timedelta(minutes=60))
        if status == "closed" and later == "closed":
            ctx.closed.add(place.id)
            return False
        return True

    def _pre_score(self, ctx: Context, stops: list[Candidate], path_m: float) -> float:
        relevance = sum(s.relevance for s in stops) / len(stops)
        quality = sum(s.quality if s.quality is not None else .5 for s in stops) / len(stops)
        nearness = max(0, 1 - path_m / (ctx.radius * max(1, len(stops))))
        return .5 * relevance + .3 * nearness + .2 * quality

    def _combos(self, ctx: Context, candidates: list[Candidate]) -> list[Combo]:
        r = ctx.request
        by_cat: dict[str, list[Candidate]] = {}
        for c in candidates:
            by_cat.setdefault(c.category, []).append(c)
        cats = [c for c in (ctx.intent.categories or ["place"]) if c in by_cat] or list(by_cat)
        if ctx.intent.free_text:
            cats = ["place"] if "place" in by_cat else []
        if not cats:
            return []
        per_cat = {1: 8, 2: 4}.get(len(cats), 3)
        for cat in cats:
            by_cat[cat].sort(key=lambda c: (-self._pre_score(ctx, [c], c.straight_m), c.place.id))
        combos: dict[str, Combo] = {}
        for picks in product(*(by_cat[c][:per_cat] for c in cats)):
            if len({p.place.id for p in picks}) < len(picks):
                continue
            ordered, here, path = [], (r.lat, r.lon), 0.0
            remaining = list(picks)
            while remaining:
                nxt = min(remaining, key=lambda c: (haversine_m(*here, c.place.lat, c.place.lon), c.place.id))
                path += haversine_m(*here, nxt.place.lat, nxt.place.lon)
                here = (nxt.place.lat, nxt.place.lon)
                ordered.append(nxt)
                remaining.remove(nxt)
            sig = signature(ctx.transport, [c.place.id for c in ordered])
            combos.setdefault(sig, Combo(ordered, self._pre_score(ctx, ordered, path), sig))
        return sorted(combos.values(), key=lambda c: (-c.pre_score, c.sig))

    async def _leg(self, cache: dict, ctx: Context, a: tuple[float, float], b: tuple[float, float], alternatives: int):
        key = (a, b, alternatives)
        if key not in cache:
            async def run():
                async with self.routing_slots:
                    return await self.client.route(a, b, ctx.transport, ctx.request.language, alternatives)
            cache[key] = asyncio.ensure_future(run())
        return await cache[key]

    async def _route_all(self, ctx: Context, combos: list[Combo], excluded: set[str]) -> list[RouteOption]:
        cache: dict = {}
        origin = (round(ctx.request.lat, 4), round(ctx.request.lon, 4))  # ~11 m; the exact position is not sent.
        # A fixed destination (named place) gets alternative paths when the provider offers them.
        alternatives = 2 if ctx.intent.free_text and ctx.transport in ("driving", "bicycle") else 0

        async def route_combo(combo: Combo):
            points = [origin] + [(c.place.lat, c.place.lon) for c in combo.stops]
            legs = []
            for i in range(len(combo.stops)):
                alt = alternatives if len(combo.stops) == 1 else 0
                legs.append(await self._leg(cache, ctx, points[i], points[i + 1], alt))
            return legs

        results = await asyncio.gather(*(route_combo(c) for c in combos), return_exceptions=True)
        failures = [e for e in results if isinstance(e, ProviderError)]
        if combos and len(failures) == len(results) and any(e.kind != "no_route" for e in failures):
            raise next(e for e in failures if e.kind != "no_route")
        for e in results:
            if isinstance(e, BaseException) and not isinstance(e, ProviderError):
                raise e
        options: list[RouteOption] = []
        for combo, legs in zip(combos, results):
            if isinstance(legs, BaseException):
                continue
            main = [variants[0] for variants in legs]
            option = self._option(ctx, combo, main, combo.sig, alt=False)
            if option:
                options.append(option)
            if len(combo.stops) == 1 and len(legs[0]) > 1:
                base_cells = path_cells(legs[0][0].coordinates)
                for variant in legs[0][1:]:
                    cells = path_cells(variant.coordinates)
                    if overlap(base_cells, cells) >= SAME_PATH_OVERLAP:
                        continue
                    sig = signature(ctx.transport, [combo.stops[0].place.id], "alt:" + hashlib.sha256(
                        repr(sorted(cells)).encode()).hexdigest()[:12])
                    if sig in excluded:
                        continue
                    alt_option = self._option(ctx, combo, [variant], sig, alt=True)
                    if alt_option:
                        options.append(alt_option)
        return options

    def _option(self, ctx: Context, combo: Combo, legs: list[RouteLeg], sig: str, alt: bool) -> RouteOption | None:
        lang, budget = ctx.request.language, ctx.budget
        travel = sum(l.minutes for l in legs)
        distance = sum(l.distance_m for l in legs)
        planned_visits = [INTENTS[c.category].visit_minutes if c.category in INTENTS else 30 for c in combo.stops]
        spare = budget - travel
        if spare < 5 * len(combo.stops):
            ctx.over_budget += 1
            return None
        # Shrink assumed visit times proportionally when the budget is tight (minimum 5 min each).
        factor = min(1, spare / sum(planned_visits))
        visits = [max(5, int(v * factor)) for v in planned_visits]

        stops, clock, statuses = [], ctx.now, []
        for cand, leg, visit in zip(combo.stops, legs, visits):
            clock += timedelta(minutes=leg.minutes)
            p = cand.place
            arrive, closes = status_at(p.schedule, p.tz_offset_min, clock)
            leave, _ = status_at(p.schedule, p.tz_offset_min, clock + timedelta(minutes=visit))
            if arrive == "closed":
                ctx.closed.add(p.id)
                return None
            hours = "unknown" if arrive == "unknown" else "closes_soon" if leave == "closed" else "open"
            statuses.append(hours)
            access = p.has_attribute(*ACCESS_TAGS)
            stops.append(Stop(id=p.id, name=p.name, lat=p.lat, lon=p.lon, category=cand.category, rubric=cand.rubric,
                              address=p.address, rating=p.rating if p.review_count else None, review_count=p.review_count,
                              hours_status=hours, closes_at=closes, average_check=p.average_check(),
                              accessibility=access, laptop_friendly=cand.laptop, source_url=p.source_url,
                              travel_minutes=leg.minutes, travel_distance_m=leg.distance_m,
                              transit_summary=leg.summary, visit_minutes=visit))
            clock += timedelta(minutes=visit)

        relevance = sum(c.relevance for c in combo.stops) / len(combo.stops)
        travel_score = max(0, 1 - travel / budget)
        quality = sum(c.quality if c.quality is not None else .5 for c in combo.stops) / len(combo.stops)
        constraint_parts = [{"open": 1, "closes_soon": .3, "unknown": .5}[h] for h in statuses]
        if ctx.intent.accessible:
            constraint_parts += [1 if s.accessibility else .5 for s in stops]
        if ctx.intent.cheap:
            constraint_parts += [1 if s.average_check is not None else .5 for s in stops]
        constraints = sum(constraint_parts) / len(constraint_parts)
        total = (WEIGHTS["relevance"] * relevance + WEIGHTS["travel"] * travel_score
                 + WEIGHTS["quality"] * quality + WEIGHTS["constraints"] * constraints)

        geometry: list[list[float]] = []
        for leg in legs:
            geometry.extend(p for p in leg.coordinates if not geometry or p != geometry[-1])
        cat_names = CATEGORY[lang]
        if len(stops) == 1:
            title = f"{cat_names.get(stops[0].category, cat_names['place'])}: {stops[0].name}"
        else:
            title = " → ".join(s.name for s in stops)
        return RouteOption(
            id=sig, title=title, transport=ctx.transport, stops=stops, travel_minutes=travel, travel_distance_m=distance,
            visit_minutes=sum(visits), total_minutes=travel + sum(visits),
            geometry={"type": "LineString", "coordinates": geometry if len(geometry) > 1 else geometry * 2},
            explanation=self._explain(ctx, combo, stops, travel, distance, alt), badges=[],
            score=Score(relevance=round(relevance, 3), travel=round(travel_score, 3), quality=round(quality, 3),
                        constraints=round(constraints, 3), total=round(total, 4)))

    def _explain(self, ctx: Context, combo: Combo, stops: list[Stop], travel: int, distance: int, alt: bool) -> list[str]:
        lang = ctx.request.language
        t, cats = T[lang], CATEGORY[lang]
        lines = []
        if alt:
            lines.append(t["alt_path"])
        lines.append((t["travel_one"] if len(stops) == 1 else t["travel_multi"]).format(
            n=travel, mode=MODE[lang][ctx.transport], dist=distance_text(distance, lang)))
        transit = [s.transit_summary for s in stops if s.transit_summary]
        if transit:
            lines.append(t["transit"].format(lines="; ".join(transit)))
        for cand, stop in zip(combo.stops, stops):
            prefix = f"{stop.name}: " if len(stops) > 1 else ""
            if cand.category == "place":
                parts = [t["match_text"].format(q=ctx.intent.free_text)]
            elif cand.laptop:
                parts = [t["match_laptop"].format(label=cand.laptop)]
            else:
                parts = [t["match_rubric"].format(cat=cats[cand.category], rubric=cand.rubric)]
            parts.append(t["rating"].format(r=f"{stop.rating:.1f}", c=stop.review_count)
                         if cand.quality is not None else t["no_rating"])
            if stop.hours_status == "open":
                parts.append(t["open"].format(until=t["until"].format(t=stop.closes_at) if stop.closes_at else ""))
            elif stop.hours_status == "closes_soon":
                parts.append(t["closes_soon"].format(t=stop.closes_at))
            else:
                parts.append(t["hours_unknown"])
            if ctx.intent.cheap:
                parts.append(t["check"].format(n=stop.average_check) if stop.average_check else t["check_unknown"])
            if ctx.intent.accessible:
                parts.append(t["accessible"].format(label=stop.accessibility) if stop.accessibility else t["accessible_unknown"])
            lines.append(prefix + " ".join(parts))
        return lines

    def _badges(self, options: list[RouteOption]) -> list[RouteOption]:
        if len(options) < 2:
            return options
        fastest = min(o.travel_minutes for o in options)
        if sum(o.travel_minutes == fastest for o in options) == 1:
            next(o for o in options if o.travel_minutes == fastest).badges.append("fastest")
        rated = [o for o in options if len(o.stops) == 1 and o.stops[0].rating is not None
                 and o.stops[0].review_count >= 20]
        if len(rated) >= 2:
            top = max(o.stops[0].rating for o in rated)
            winners = [o for o in rated if o.stops[0].rating == top]
            if len(winners) == 1:
                winners[0].badges.append("top_rated")
        return options

    def _notices(self, ctx: Context, interp: Interpretation, options: list[RouteOption]) -> list[str]:
        lang = ctx.request.language
        t = T[lang]
        out = []
        if interp.budget_from_text:
            out.append(t["n_budget"].format(n=ctx.budget))
        if interp.transport_from_text:
            out.append(t["n_transport"].format(mode=MODE[lang][ctx.transport]))
        if interp.source == "model":
            out.append(t["n_model"])
        stops = [s for o in options for s in o.stops]
        if ctx.intent.quiet:
            out.append(t["n_quiet"])
        if ctx.intent.cheap and any(s.average_check is None for s in stops):
            out.append(t["n_cheap_unknown"].format(n=CHEAP_MAX_CHECK))
        if ctx.intent.accessible and any(not s.accessibility for s in stops):
            out.append(t["n_access_unknown"])
        if any(s.hours_status == "unknown" for s in stops):
            out.append(t["n_open_unknown"])
        if ctx.closed:
            out.append(t["n_closed"].format(n=len(ctx.closed)))
        if ctx.over_budget:
            out.append(t["n_over_budget"].format(n=ctx.over_budget))
        if 0 < len(options) < 3:
            out.append(t["n_few"])
        km = f"{ctx.radius / 1000:.1f}"
        out.append(t["n_radius"].format(km=km if lang == "en" else km.replace(".", ",")))
        return out
