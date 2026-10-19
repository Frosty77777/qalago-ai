import type { Language } from '../api/types'
import { MODE_IDS, ORIGIN_PRESETS, type ModeId } from './presets'

export interface ShareParams {
  query?: string
  minutes?: number
  mode?: ModeId
  lang?: Language
  /** Preset origin id only. Exact coordinates are never written to the URL. */
  origin?: string
}

export function readShareParams(search: string): ShareParams {
  const p = new URLSearchParams(search)
  const minutes = Number(p.get('min'))
  const mode = p.get('mode')
  const lang = p.get('lang')
  const origin = p.get('origin')
  return {
    query: p.get('q')?.slice(0, 500) || undefined,
    minutes: Number.isFinite(minutes) && minutes >= 15 && minutes <= 240 ? Math.round(minutes / 15) * 15 : undefined,
    mode: MODE_IDS.includes(mode as ModeId) ? (mode as ModeId) : undefined,
    lang: lang === 'ru' || lang === 'kk' || lang === 'en' ? lang : undefined,
    origin: ORIGIN_PRESETS.some((o) => o.id === origin) ? (origin ?? undefined) : undefined,
  }
}

export function buildShareUrl(loc: Pick<Location, 'origin' | 'pathname'>, s: ShareParams): string {
  const p = new URLSearchParams()
  if (s.query) p.set('q', s.query)
  if (s.minutes) p.set('min', String(s.minutes))
  if (s.mode) p.set('mode', s.mode)
  if (s.lang) p.set('lang', s.lang)
  if (s.origin) p.set('origin', s.origin)
  return `${loc.origin}${loc.pathname}?${p.toString()}`
}
