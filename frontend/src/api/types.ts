// Types mirror docs/API_CONTRACT.md (QalaGo AI v1). Do not rename fields without agreement with backend.

export type Language = 'ru' | 'kk' | 'en'
export type ApiMode = 'walk' | 'general'
export type AvailabilityStatus = 'verified_open' | 'verified_closed' | 'unknown'

export interface RecommendRequest {
  query: string
  lat: number
  lon: number
  max_minutes: number
  language: Language
  mode?: ApiMode
  preferences?: string[]
}

export interface Recommendation {
  id: string
  name: string
  category: string
  lat: number
  lon: number
  /** Haversine straight-line distance, metres. */
  distance_m: number
  reason: string
  visit_minutes: number
  activity: string
  opening_hours: string | null
  source: string
  source_url?: string | null
  facts?: string[] | null
  /** Null unless backed by a walking-routing provider. */
  walk_minutes?: number | null
  walk_time_source?: string | null
  availability_status?: AvailabilityStatus | null
}

/** GeoJSON LineString, coordinates are [lon, lat]. */
export interface RouteGeometry {
  type: 'LineString'
  coordinates: [number, number][]
}

export interface Route {
  ordered_poi_ids: string[]
  geometry: RouteGeometry | null
  route_minutes: number | null
  is_approximate: boolean
}

export interface RecommendResponse {
  recommendations: Recommendation[]
  route: Route | null
  data_updated_at: string | null
  warnings: string[]
  retrieval_debug: unknown
}

export interface Poi {
  id: string
  name: string
  category: string
  lat: number
  lon: number
  source_url: string
  opening_hours?: string | null
  tags?: Record<string, string>
  description?: string | null
  updated_at?: string | null
}

export interface Health {
  status: string
  poi_count: number
  llm_enabled: boolean
  dataset_updated_at: string | null
}
