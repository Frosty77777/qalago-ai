import type { ApiMode, Language } from '../api/types'
import type { LatLon } from './geo'

export interface OriginPreset extends LatLon {
  id: string
  osmId: string
  label: Record<Language, string>
}

// Coordinates are the OSM centroids of the named features, checked via Overpass on 2026-10-19.
// They mark the area, not a specific entrance.
export const ORIGIN_PRESETS: OriginPreset[] = [
  {
    id: 'expo',
    osmId: 'way/454853233',
    lat: 51.09279,
    lon: 71.42148,
    label: { en: 'EXPO area', ru: 'Район EXPO', kk: 'EXPO маңы' },
  },
  {
    id: 'baiterek',
    osmId: 'way/230401645',
    lat: 51.12829,
    lon: 71.43045,
    label: { en: 'Bayterek area', ru: 'Район Байтерека', kk: 'Бәйтерек маңы' },
  },
  {
    id: 'embankment',
    osmId: 'way/263517343',
    lat: 51.16032,
    lon: 71.41879,
    label: { en: 'Esil embankment (Seruen bridge)', ru: 'Набережная Есиля (мост Серуен)', kk: 'Есіл жағалауы (Серуен көпірі)' },
  },
]

export type ModeId = 'walk' | 'family' | 'friends' | 'date' | 'solo'

/** UI mode presets. Each maps to a real API mode plus preferences that change retrieval. */
export const MODES: Record<ModeId, { api: ApiMode; preferences: string[] }> = {
  walk: { api: 'walk', preferences: ['walk', 'park', 'architecture'] },
  family: { api: 'walk', preferences: ['family', 'children', 'playground', 'park', 'museum'] },
  friends: { api: 'general', preferences: ['friends', 'cafe', 'attraction'] },
  date: { api: 'walk', preferences: ['date', 'viewpoint', 'park', 'cafe'] },
  solo: { api: 'general', preferences: ['solo', 'museum', 'library', 'cafe'] },
}

export const MODE_IDS = Object.keys(MODES) as ModeId[]

export type ScenarioId = 'walk60' | 'coffee' | 'family' | 'tourist2h' | 'evening'

export interface Scenario {
  id: ScenarioId
  minutes: number
  mode: ModeId
  extraPreferences: string[]
  query: Record<Language, string>
}

export const SCENARIOS: Scenario[] = [
  {
    id: 'walk60',
    minutes: 60,
    mode: 'walk',
    extraPreferences: [],
    query: { en: 'I want a 30–60 minute walk nearby', ru: 'Хочу прогуляться рядом 30–60 минут', kk: 'Жақын жерде 30–60 минут серуендегім келеді' },
  },
  {
    id: 'coffee',
    minutes: 45,
    mode: 'solo',
    extraPreferences: ['coffee', 'quiet'],
    query: { en: 'A quiet coffee place nearby', ru: 'Тихое место для кофе рядом', kk: 'Жақын жердегі тыныш кофехана' },
  },
  {
    id: 'family',
    minutes: 120,
    mode: 'family',
    extraPreferences: [],
    query: { en: 'Something to do with a child for 2 hours', ru: 'Чем заняться с ребёнком на 2 часа', kk: 'Баламен 2 сағат не істеуге болады' },
  },
  {
    id: 'tourist2h',
    minutes: 120,
    mode: 'walk',
    extraPreferences: ['sightseeing', 'landmark'],
    query: { en: 'I am a tourist with 2 hours before my flight', ru: 'Я турист, у меня 2 часа до рейса', kk: 'Мен туристпін, рейске дейін 2 сағатым бар' },
  },
  {
    id: 'evening',
    minutes: 90,
    mode: 'friends',
    extraPreferences: ['evening', 'viewpoint', 'park'],
    query: { en: 'An evening walk to explore the city', ru: 'Вечерняя прогулка по городу', kk: 'Қаланы аралайтын кешкі серуен' },
  },
]

/** Queries mentioning a flight or airport get an explicit "travel time not included" notice (T04). */
export const FLIGHT_PATTERN = /flight|airport|рейс|аэропорт|самол[её]т|әуежай|ұшақ/i
