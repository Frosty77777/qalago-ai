import type { IntentId, Language, Transport } from '../api/types'
import type { LatLon } from './geo'

export interface OriginPreset extends LatLon {
  id: string
  label: Record<Language, string>
}

// Centroids of the named areas (OSM, checked 2026-10-19). They mark an area, not an entrance.
export const ORIGIN_PRESETS: OriginPreset[] = [
  { id: 'expo', lat: 51.09279, lon: 71.42148, label: { en: 'EXPO area', ru: 'Район EXPO', kk: 'EXPO маңы' } },
  { id: 'baiterek', lat: 51.12829, lon: 71.43045, label: { en: 'Bayterek area', ru: 'Район Байтерека', kk: 'Бәйтерек маңы' } },
  {
    id: 'embankment',
    lat: 51.16032,
    lon: 71.41879,
    label: { en: 'Esil embankment', ru: 'Набережная Есиля', kk: 'Есіл жағалауы' },
  },
]

export const TRANSPORTS: Transport[] = ['walking', 'public_transport', 'bicycle', 'driving']

/** Example requests. They are only filled into the query box; results always come from 2GIS. */
export const EXAMPLES: { id: string; query: Record<Language, string> }[] = [
  { id: 'coffee', query: { ru: 'Хочу кофе', kk: 'Кофе ішкім келеді', en: 'I want coffee' } },
  { id: 'food', query: { ru: 'Хочу поесть', kk: 'Тамақ ішкім келеді', en: 'I want something to eat' } },
  { id: 'park', query: { ru: 'Хочу погулять в парке', kk: 'Саябақта серуендегім келеді', en: 'I want to walk in a park' } },
  { id: 'study', query: { ru: 'Тихое место, чтобы позаниматься', kk: 'Сабақ оқитын тыныш орын', en: 'Find a quiet place to study' } },
  {
    id: 'combo',
    query: { ru: 'У меня два часа: кофе и прогулка', kk: 'Екі сағатым бар: кофе және серуен', en: 'I have two hours and want coffee and a walk' },
  },
]

export const INTENT_IDS: IntentId[] = ['coffee', 'food', 'park', 'museum', 'sights', 'study', 'kids']
