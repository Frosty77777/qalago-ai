import type { IntentId, Transport } from '../api/types'

/** Route signatures shown in one exploration session. Older entries fall off first. */
export const MAX_SEEN = 30

export interface ExplorationKey {
  query: string
  lat: number
  lon: number
  minutes: number
  transport: Transport
  categories: IntentId[]
}

/**
 * Two requests belong to the same exploration when the user has not meaningfully changed
 * what they asked for. Origin jitter under ~50 m (e.g. a re-read GPS fix) does not count.
 */
export function sameExploration(a: ExplorationKey | null, b: ExplorationKey): boolean {
  if (!a) return false
  return (
    a.query.trim().toLocaleLowerCase() === b.query.trim().toLocaleLowerCase() &&
    Math.abs(a.lat - b.lat) < 0.0005 &&
    Math.abs(a.lon - b.lon) < 0.0005 &&
    a.minutes === b.minutes &&
    a.transport === b.transport &&
    a.categories.join() === b.categories.join()
  )
}

export function remember(seen: string[], ids: string[]): string[] {
  const next = [...seen.filter((s) => !ids.includes(s)), ...ids]
  return next.slice(-MAX_SEEN)
}
