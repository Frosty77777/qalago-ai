export interface LatLon {
  lat: number
  lon: number
}

const EARTH_RADIUS_M = 6_371_000

/** Straight-line ("as the crow flies") distance in metres. Not a walking distance. */
export function haversineM(a: LatLon, b: LatLon): number {
  const rad = Math.PI / 180
  const dLat = (b.lat - a.lat) * rad
  const dLon = (b.lon - a.lon) * rad
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h))
}

export function formatDistance(meters: number, locale: string): string {
  if (meters < 1000) return `${Math.round(meters / 10) * 10} ${locale === 'en' ? 'm' : 'м'}`
  const km = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(meters / 1000)
  return `${km} ${locale === 'en' ? 'km' : 'км'}`
}

/** Astana city centre — used only as the initial map view. */
export const ASTANA_CENTER: LatLon = { lat: 51.128, lon: 71.43 }
