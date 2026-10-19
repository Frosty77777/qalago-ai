// DEMO DATA ONLY. Used when VITE_USE_MOCKS=true or when the user explicitly switches to demo data.
// POIs come from a real OpenStreetMap snapshot (see scripts/fetch-demo-fixture.mjs); the reason and
// activity texts are deterministic templates, not AI output. The UI always shows a "Demo data" badge.
import type { ApiClient } from '../api/client'
import type { Health, Language, Poi, Recommendation, RecommendRequest, RecommendResponse } from '../api/types'
import { haversineM } from '../lib/geo'
import fixture from './demoPois.json'

interface FixturePoi extends Poi {
  collected_at: string
}

const POIS = fixture.pois as unknown as FixturePoi[]

const KEYWORDS: Record<string, string[]> = {
  cafe: ['coffee', 'cafe', 'кофе', 'кафе', 'кофе', 'тамақ', 'breakfast', 'завтрак'],
  park: ['park', 'walk', 'nature', 'парк', 'прогул', 'саябақ', 'серуен', 'family', 'семь', 'отбас', 'greenery'],
  garden: ['garden', 'nature', 'сад', 'бақ', 'park'],
  playground: ['family', 'child', 'kid', 'playground', 'семь', 'ребен', 'дет', 'бала', 'отбас'],
  attraction: ['tourist', 'sight', 'landmark', 'architecture', 'турист', 'достопримеч', 'көрікті', 'evening', 'вечер', 'кеш'],
  monument: ['tourist', 'sight', 'landmark', 'history', 'architecture', 'турист', 'памятник', 'ескерткіш', 'тарих'],
  museum: ['museum', 'музей', 'indoor', 'history'],
}

const VISIT_MINUTES: Record<string, number> = { cafe: 30, park: 35, garden: 30, playground: 40, attraction: 15, monument: 20, museum: 60 }

const TEXT: Record<Language, { reason: (cat: string) => string; activity: Record<string, string>; warnings: string[]; empty: string }> = {
  en: {
    reason: (cat) => `[Demo template] Category "${cat}" matches your request and is within the straight-line radius.`,
    activity: { cafe: 'Stop for a drink or a short break', park: 'Take a relaxed walk through the park', garden: 'Walk around the garden', playground: 'Let children play here', attraction: 'Look around and take photos', monument: 'Visit the monument and read about it', museum: 'Explore the exhibition' },
    warnings: ['Demo data: real OSM snapshot with template texts, not live AI recommendations.', 'Walking time and opening hours were not independently verified.'],
    empty: 'Demo data: no matching places in the snapshot. Try a longer duration or another origin.',
  },
  ru: {
    reason: (cat) => `[Шаблон демо] Категория «${cat}» соответствует запросу и находится в пределах радиуса по прямой.`,
    activity: { cafe: 'Зайти на кофе или короткий перерыв', park: 'Спокойно прогуляться по парку', garden: 'Прогуляться по саду', playground: 'Дать детям поиграть', attraction: 'Осмотреться и сделать фото', monument: 'Осмотреть памятник', museum: 'Посмотреть экспозицию' },
    warnings: ['Демо-данные: реальный снимок OSM с шаблонными текстами, а не живые рекомендации ИИ.', 'Время пешком и часы работы не проверены.'],
    empty: 'Демо-данные: подходящих мест в снимке нет. Увеличьте время или выберите другую точку.',
  },
  kk: {
    reason: (cat) => `[Демо үлгі] «${cat}» санаты сұрауыңызға сай және түзу сызық бойынша радиус ішінде.`,
    activity: { cafe: 'Кофе ішіп, аз демалу', park: 'Саябақта асықпай серуендеу', garden: 'Бақты аралау', playground: 'Балаларға ойнауға уақыт беру', attraction: 'Айналаны көріп, суретке түсу', monument: 'Ескерткішті тамашалау', museum: 'Көрмені аралау' },
    warnings: ['Демо деректер: шаблон мәтіндері бар нақты OSM үзіндісі, тірі ЖИ ұсыныстары емес.', 'Жаяу жүру уақыты мен жұмыс уақыты тексерілмеген.'],
    empty: 'Демо деректер: үзіндіде сәйкес орындар жоқ. Уақытты ұзартып немесе басқа нүкте таңдаңыз.',
  },
}

function score(poi: FixturePoi, terms: string, distance: number, maxDistance: number): number {
  const keywordHit = (KEYWORDS[poi.category] ?? []).some((k) => terms.includes(k)) ? 1 : 0
  return keywordHit * 2 + (1 - distance / maxDistance)
}

function recommend(req: RecommendRequest): RecommendResponse {
  const terms = `${req.query} ${(req.preferences ?? []).join(' ')}`.toLowerCase()
  // Conservative straight-line radius: about a third of the time budget at 4.5 km/h, capped at 2 km.
  const maxDistance = Math.min(2000, (req.max_minutes / 3) * 75)
  const text = TEXT[req.language]

  const ranked = POIS.map((poi) => ({ poi, distance: haversineM(req, poi) }))
    .filter(({ distance }) => distance <= maxDistance)
    .sort((a, b) => score(b.poi, terms, b.distance, maxDistance) - score(a.poi, terms, a.distance, maxDistance))

  const picked: typeof ranked = []
  let budget = req.max_minutes
  for (const item of ranked) {
    if (picked.length === 3) break
    if (picked.some((p) => p.poi.name === item.poi.name || p.poi.category === item.poi.category)) continue
    const visit = VISIT_MINUTES[item.poi.category] ?? 20
    if (visit > budget) continue
    picked.push(item)
    budget -= visit
  }

  const recommendations: Recommendation[] = picked.map(({ poi, distance }) => ({
    id: poi.id,
    name: poi.name,
    category: poi.category,
    lat: poi.lat,
    lon: poi.lon,
    distance_m: Math.round(distance),
    reason: text.reason(poi.category),
    visit_minutes: VISIT_MINUTES[poi.category] ?? 20,
    activity: text.activity[poi.category] ?? text.activity.attraction,
    opening_hours: poi.opening_hours ?? null,
    source: 'OpenStreetMap',
    source_url: poi.source_url,
    facts: Object.entries(poi.tags ?? {})
      .filter(([k]) => ['amenity', 'leisure', 'tourism', 'historic', 'cuisine', 'wheelchair', 'opening_hours', 'outdoor_seating'].includes(k))
      .map(([k, v]) => `${k}=${v}`),
    walk_minutes: null,
    walk_time_source: null,
    // The demo layer never parses opening hours, so availability is always unknown.
    availability_status: 'unknown',
  }))

  return {
    recommendations,
    // Like the real backend (P0): independent visit options, no ordered route.
    route: null,
    data_updated_at: fixture.collected_at,
    warnings: recommendations.length ? text.warnings : [text.empty],
    retrieval_debug: { demo: true, candidates_in_radius: ranked.length, radius_m: Math.round(maxDistance) },
  }
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms))

export const mockApi: ApiClient = {
  async health(): Promise<Health> {
    return { status: 'ok', poi_count: POIS.length, llm_enabled: false, dataset_updated_at: fixture.collected_at }
  },
  async pois(): Promise<Poi[]> {
    return POIS
  },
  async recommend(req) {
    await delay(450)
    return recommend(req)
  },
}
