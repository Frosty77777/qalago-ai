import type { GeocodeResult, Language, PlanRequest, PlanResponse, PublicConfig, User } from './types'

// Empty = same origin. Production serves the UI and /api from one origin through nginx,
// and `npm run dev` proxies /api to the backend (see vite.config.ts).
export const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/+$/, '')

export type ApiErrorKind =
  | 'network'
  | 'timeout'
  | 'validation'
  | 'rate_limited'
  | 'not_configured'
  | 'key_rejected'
  | 'provider_unavailable'
  | 'auth_failed'
  | 'account_conflict'
  | 'server'
  | 'bad_response'

export class ApiError extends Error {
  readonly kind: ApiErrorKind
  readonly status?: number
  /** The provider service that failed, e.g. "places" or "routing". */
  readonly service?: string | null
  readonly retryAfter?: number

  constructor(kind: ApiErrorKind, message: string, status?: number, service?: string | null, retryAfter?: number) {
    super(message)
    this.name = 'ApiError'
    this.kind = kind
    this.status = status
    this.service = service
    this.retryAfter = retryAfter
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST'
  body?: unknown
  timeoutMs?: number
  /** Only for idempotent reads; POSTs that trigger paid provider calls are never retried here. */
  retries?: number
  signal?: AbortSignal
}

function sleep(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => {
      clearTimeout(timer)
      reject(new DOMException('Aborted', 'AbortError'))
    })
  })
}

/** Map the backend's {error: {kind, service}} body to a UI error kind. */
function toApiError(res: Response, body: unknown): ApiError {
  const err = (body as { error?: { kind?: string; service?: string | null } } | undefined)?.error
  const retryAfter = Number(res.headers.get('Retry-After')) || undefined
  const kind = err?.kind
  const service = err?.service
  if (res.status === 422) return new ApiError('validation', 'Request rejected by server', 422)
  if (res.status === 429 || kind === 'rate_limited') return new ApiError('rate_limited', 'Too many requests', res.status, service, retryAfter)
  if (kind === 'not_configured') return new ApiError('not_configured', 'Provider not configured', res.status, service)
  if (kind === 'key_rejected') return new ApiError('key_rejected', 'Provider rejected the key', res.status, service)
  if (kind === 'unavailable' || kind === 'bad_response' || kind === 'no_route')
    return new ApiError('provider_unavailable', 'Provider unavailable', res.status, service)
  if (kind === 'account_conflict') return new ApiError('account_conflict', 'Account conflict', res.status, service)
  if (service === 'auth') return new ApiError('auth_failed', kind ?? 'Sign-in failed', res.status, service)
  return new ApiError('server', `Server responded ${res.status}`, res.status, service)
}

async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, timeoutMs = 15_000, retries = 0, signal } = opts
  let lastError: ApiError | undefined

  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await sleep(400 * 2 ** (attempt - 1), signal)
    const controller = new AbortController()
    const onAbort = () => controller.abort()
    signal?.addEventListener('abort', onAbort)
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, timeoutMs)

    let res: Response
    let parsed: unknown
    try {
      res = await fetch(`${API_BASE_URL}${path}`, {
        method,
        credentials: 'include',
        headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      })
      parsed = res.status === 204 ? null : await res.json().catch(() => undefined)
    } catch (err) {
      if (signal?.aborted) throw err
      lastError = timedOut ? new ApiError('timeout', 'Request timed out') : new ApiError('network', 'Backend is unreachable')
      continue
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
    }

    if (res.ok) {
      if (parsed === undefined) throw new ApiError('bad_response', 'Response was not valid JSON', res.status)
      return parsed as T
    }
    lastError = toApiError(res, parsed)
    if (![502, 503, 504].includes(res.status) || lastError.kind === 'key_rejected' || lastError.kind === 'not_configured') throw lastError
  }
  throw lastError ?? new ApiError('network', 'Backend is unreachable')
}

export const api = {
  config: (signal?: AbortSignal) => request<PublicConfig>('/api/config', { signal, retries: 2, timeoutMs: 6_000 }),
  plan: async (req: PlanRequest, signal?: AbortSignal) => {
    // Several 2GIS searches and routes run server-side; allow time but do not retry paid work.
    const res = await request<PlanResponse>('/api/plan', { method: 'POST', body: req, signal, timeoutMs: 40_000 })
    if (!res || !Array.isArray(res.options) || typeof res.status !== 'string') throw new ApiError('bad_response', 'Malformed plan')
    return { ...res, places: res.places ?? [], notices: res.notices ?? [], suggestions: res.suggestions ?? [], choices: res.choices ?? [] }
  },
  geocode: (q: string, near: { lat: number; lon: number } | null, language: Language, signal?: AbortSignal) => {
    const p = new URLSearchParams({ q, language })
    if (near) {
      p.set('lat', near.lat.toFixed(3))
      p.set('lon', near.lon.toFixed(3))
    }
    return request<GeocodeResult[]>(`/api/geocode?${p}`, { signal, retries: 1 })
  },
  reverseGeocode: (lat: number, lon: number, language: Language, signal?: AbortSignal) =>
    request<{ name: string | null }>(`/api/reverse-geocode?lat=${lat.toFixed(5)}&lon=${lon.toFixed(5)}&language=${language}`, { signal }),
  me: (signal?: AbortSignal) => request<{ user: User | null; auth_enabled: boolean }>('/api/auth/me', { signal, retries: 2, timeoutMs: 6_000 }),
  signInWithGoogle: (credential: string) => request<{ user: User }>('/api/auth/google', { method: 'POST', body: { credential } }),
  signOut: () => request<null>('/api/auth/logout', { method: 'POST' }),
}
