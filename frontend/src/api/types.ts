// Types mirror backend/app/plan_models.py and the auth endpoints in backend/app/main.py.

export type Language = 'ru' | 'kk' | 'en'
export type Transport = 'walking' | 'driving' | 'bicycle' | 'public_transport'
export type IntentId = 'coffee' | 'food' | 'park' | 'museum' | 'study' | 'sights' | 'kids'
export type Suggestion = 'expand_radius' | 'longer_time' | 'change_preferences' | 'change_transport'

export interface PlanRequest {
  query: string
  lat: number
  lon: number
  max_minutes: number
  language: Language
  transport: Transport
  categories?: IntentId[]
  /** Route signatures already shown in this exploration session. */
  seen?: string[]
  /** Signatures that must not come back (the route on screen when "Another route" was pressed). */
  exclude?: string[]
  radius_level?: number
}

export interface Stop {
  id: string
  name: string
  lat: number
  lon: number
  category: string
  rubric: string | null
  address: string | null
  rating: number | null
  review_count: number
  hours_status: 'open' | 'closes_soon' | 'unknown'
  closes_at: string | null
  average_check: number | null
  accessibility: string | null
  laptop_friendly: string | null
  source_url: string
  travel_minutes: number
  travel_distance_m: number
  transit_summary: string | null
  /** Assumed time at the stop; an estimate, not provider data. */
  visit_minutes: number
}

/** GeoJSON LineString, coordinates are [lon, lat]. */
export interface LineString {
  type: 'LineString'
  coordinates: [number, number][]
}

export interface RouteOption {
  id: string
  title: string
  transport: Transport
  stops: Stop[]
  travel_minutes: number
  travel_distance_m: number
  visit_minutes: number
  total_minutes: number
  geometry: LineString
  explanation: string[]
  badges: ('fastest' | 'top_rated')[]
  score: { relevance: number; travel: number; quality: number; constraints: number; total: number }
}

export interface Interpretation {
  categories: string[]
  free_text: string | null
  transport: Transport
  transport_from_text: boolean
  budget_minutes: number
  budget_from_text: boolean
  open_now: boolean
  cheap: boolean
  accessible: boolean
  quiet: boolean
  source: 'rules' | 'model' | 'override'
}

/** A real 2GIS place shown without a route because routing was unavailable. */
export interface Place {
  id: string
  name: string
  lat: number
  lon: number
  category: string
  rubric: string | null
  address: string | null
  rating: number | null
  review_count: number
  hours_status: 'open' | 'unknown'
  closes_at: string | null
  source_url: string
  straight_distance_m: number
}

export interface PlanResponse {
  status: 'ok' | 'clarify' | 'empty' | 'exhausted' | 'routing_unavailable'
  options: RouteOption[]
  places: Place[]
  routing_error: { kind: string; service: string } | null
  interpretation: Interpretation | null
  question: string | null
  choices: IntentId[]
  notices: string[]
  suggestions: Suggestion[]
  ranking_note: string | null
  radius_m: number | null
  attribution: string
}

export interface GeocodeResult {
  name: string
  lat: number
  lon: number
}

export interface PublicConfig {
  twogis_map_key: string | null
  google_client_id: string | null
  places_enabled: boolean
}

export interface User {
  id: number
  email: string | null
  name: string | null
  picture: string | null
}
