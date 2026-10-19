import type { Health, Poi, RecommendRequest, RecommendResponse } from './types'
import { mockApi } from '../mocks/mockApi'

export const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000').replace(/\/+$/, '')
export const MOCKS_FORCED = import.meta.env.VITE_USE_MOCKS === 'true'

export type ApiErrorKind = 'network' | 'timeout' | 'validation' | 'unavailable' | 'server' | 'bad_response'

export class ApiError extends Error {
  readonly kind: ApiErrorKind
  readonly status?: number
  readonly details?: string[]

  constructor(kind: ApiErrorKind, message: string, status?: number, details?: string[]) {
    super(message)
    this.name = 'ApiError'
    this.kind = kind
    this.status = status
    this.details = details
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST'
  body?: unknown
  timeoutMs?: number
  retries?: number
  signal?: AbortSignal
}

const RETRYABLE_STATUS = new Set([502, 503, 504])

function sleep(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => {
      clearTimeout(timer)
      reject(new DOMException('Aborted', 'AbortError'))
    })
  })
}

/** FastAPI 422 bodies look like {detail: [{loc, msg}]}; flatten them for display. */
function validationDetails(body: unknown): string[] | undefined {
  if (!body || typeof body !== 'object' || !('detail' in body)) return undefined
  const detail = (body as { detail: unknown }).detail
  if (typeof detail === 'string') return [detail]
  if (!Array.isArray(detail)) return undefined
  return detail.map((d) => {
    const item = d as { loc?: unknown[]; msg?: string }
    const field = Array.isArray(item.loc) ? item.loc.filter((p) => p !== 'body').join('.') : ''
    return field ? `${field}: ${item.msg ?? ''}` : (item.msg ?? String(d))
  })
}

async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, timeoutMs = 12_000, retries = 2, signal } = opts
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
        headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      })
      parsed = await res.json().catch(() => undefined)
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
    if (res.status === 422 || res.status === 400) {
      throw new ApiError('validation', 'Request rejected by server', res.status, validationDetails(parsed))
    }
    lastError = new ApiError(res.status === 503 ? 'unavailable' : 'server', `Server responded ${res.status}`, res.status)
    if (!RETRYABLE_STATUS.has(res.status)) throw lastError
  }
  throw lastError ?? new ApiError('network', 'Backend is unreachable')
}

export interface ApiClient {
  health(signal?: AbortSignal): Promise<Health>
  pois(signal?: AbortSignal): Promise<Poi[]>
  recommend(req: RecommendRequest, signal?: AbortSignal): Promise<RecommendResponse>
}

export const liveApi: ApiClient = {
  health: (signal) => request<Health>('/api/health', { signal, retries: 1, timeoutMs: 6_000 }),
  pois: (signal) => request<Poi[]>('/api/pois?limit=5000', { signal }),
  recommend: async (req, signal) => {
    const res = await request<RecommendResponse>('/api/recommend', {
      method: 'POST',
      body: req,
      signal,
      // Gemini generation can be slow; backend falls back deterministically on model failure.
      timeoutMs: 30_000,
      retries: 1,
    })
    if (!Array.isArray(res.recommendations)) throw new ApiError('bad_response', 'Missing recommendations array')
    return { ...res, warnings: res.warnings ?? [], route: res.route ?? null }
  },
}

export function getApi(useDemoData: boolean): ApiClient {
  return useDemoData ? mockApi : liveApi
}
