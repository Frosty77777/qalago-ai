import type { Language, Transport } from '../api/types'
import { ORIGIN_PRESETS, TRANSPORTS } from './presets'

export interface ShareParams {
  query?: string
  minutes?: number
  transport?: Transport
  lang?: Language
  /** Preset origin id only. Exact coordinates are never written to the URL. */
  origin?: string
}

export function readShareParams(search: string): ShareParams {
  const p = new URLSearchParams(search)
  const minutes = Number(p.get('min'))
  const transport = p.get('tr')
  const lang = p.get('lang')
  const origin = p.get('origin')
  return {
    query: p.get('q')?.slice(0, 500) || undefined,
    minutes: Number.isFinite(minutes) && minutes >= 15 && minutes <= 240 ? Math.round(minutes / 15) * 15 : undefined,
    transport: TRANSPORTS.includes(transport as Transport) ? (transport as Transport) : undefined,
    lang: lang === 'ru' || lang === 'kk' || lang === 'en' ? lang : undefined,
    origin: ORIGIN_PRESETS.some((o) => o.id === origin) ? (origin ?? undefined) : undefined,
  }
}

export function buildShareUrl(loc: Pick<Location, 'origin' | 'pathname'>, s: ShareParams): string {
  const p = new URLSearchParams()
  if (s.query) p.set('q', s.query)
  if (s.minutes) p.set('min', String(s.minutes))
  if (s.transport) p.set('tr', s.transport)
  if (s.lang) p.set('lang', s.lang)
  if (s.origin) p.set('origin', s.origin)
  return `${loc.origin}${loc.pathname}?${p.toString()}`
}
