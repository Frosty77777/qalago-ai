import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, ApiError } from './api/client'
import type { GeocodeResult, IntentId, Language, PlanRequest, PlanResponse, PublicConfig, Suggestion, Transport, User } from './api/types'
import { AuthControl } from './components/AuthControl'
import { MapView } from './components/MapView'
import { ResultsPanel } from './components/ResultsPanel'
import { SearchForm, type OriginKind } from './components/SearchForm'
import { useI18n } from './i18n/I18nContext'
import { LANGUAGES, type StringKey } from './i18n/strings'
import { formatDistance, type LatLon } from './lib/geo'
import { ORIGIN_PRESETS } from './lib/presets'
import { remember, sameExploration, type ExplorationKey } from './lib/routeHistory'
import { buildShareUrl, readShareParams } from './lib/share'

type Status = 'idle' | 'loading' | 'success' | 'error'
type SheetState = 'peek' | 'half' | 'full'
type AnotherState = 'idle' | 'loading' | 'exhausted' | 'error'

function useIsDesktop() {
  const query = '(min-width: 768px)'
  const [desktop, setDesktop] = useState(() => window.matchMedia(query).matches)
  useEffect(() => {
    const mq = window.matchMedia(query)
    const onChange = () => setDesktop(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return desktop
}

function useViewportHeight() {
  const [h, setH] = useState(() => window.innerHeight)
  useEffect(() => {
    const onResize = () => setH(window.innerHeight)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  return h
}

const keyOf = (r: PlanRequest): ExplorationKey => ({
  query: r.query,
  lat: r.lat,
  lon: r.lon,
  minutes: r.max_minutes,
  transport: r.transport,
  categories: r.categories ?? [],
})

export default function App() {
  const { t, lang, setLang, locale } = useI18n()
  const isDesktop = useIsDesktop()
  const viewportHeight = useViewportHeight()
  const shared = useMemo(() => readShareParams(window.location.search), [])

  const [config, setConfig] = useState<{ state: 'loading' | 'ok' | 'failed'; data?: PublicConfig }>({ state: 'loading' })
  const [user, setUser] = useState<User | null>(null)
  const [sessionRestored, setSessionRestored] = useState(false)

  const sharedPreset = ORIGIN_PRESETS.find((p) => p.id === shared.origin)
  const [origin, setOrigin] = useState<LatLon | null>(sharedPreset ? { lat: sharedPreset.lat, lon: sharedPreset.lon } : null)
  const [originKind, setOriginKind] = useState<OriginKind>(sharedPreset ? { kind: 'preset', id: sharedPreset.id } : null)
  const [originName, setOriginName] = useState<string | null>(null)
  const [geoState, setGeoState] = useState<'idle' | 'locating' | 'denied' | 'unavailable'>('idle')

  const [query, setQuery] = useState(shared.query ?? '')
  const [minutes, setMinutes] = useState(shared.minutes ?? 60)
  const [transport, setTransport] = useState<Transport>(shared.transport ?? 'walking')
  const [formError, setFormError] = useState<StringKey | null>(null)

  const [status, setStatus] = useState<Status>('idle')
  const [response, setResponse] = useState<PlanResponse | null>(null)
  const [error, setError] = useState<ApiError | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [lastRequest, setLastRequest] = useState<PlanRequest | null>(null)
  const [anotherState, setAnotherState] = useState<AnotherState>('idle')
  const [anotherError, setAnotherError] = useState<ApiError | null>(null)
  const [sheet, setSheet] = useState<SheetState>('half')

  // Bounded history of route signatures shown for the current exploration.
  const seenRef = useRef<string[]>([])
  const explorationRef = useRef<ExplorationKey | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const queryRef = useRef<HTMLDivElement | null>(null)
  const resultsRef = useRef<HTMLElement | null>(null)

  const loadConfig = useCallback(() => {
    setConfig({ state: 'loading' })
    api
      .config()
      .then((data) => setConfig({ state: 'ok', data }))
      .catch(() => setConfig({ state: 'failed' }))
  }, [])

  useEffect(() => {
    loadConfig()
    api
      .me()
      .then((res) => setUser(res.user))
      .catch(() => setUser(null))
      .finally(() => setSessionRestored(true))
  }, [loadConfig])

  useEffect(() => {
    if (status === 'success' || status === 'error') resultsRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }, [status, response])

  const accept = useCallback((req: PlanRequest, res: PlanResponse) => {
    const key = keyOf(req)
    if (!sameExploration(explorationRef.current, key)) seenRef.current = []
    explorationRef.current = key
    seenRef.current = remember(
      seenRef.current,
      res.options.map((o) => o.id),
    )
    setResponse(res)
    setSelectedId(res.options[0]?.id ?? null)
  }, [])

  /** A fresh search. With `withHistory`, already-shown routes are excluded (used by "search a wider area"). */
  const run = useCallback(
    async (req: PlanRequest, withHistory = false) => {
      abortRef.current?.abort()
      const ctl = new AbortController()
      abortRef.current = ctl
      const sendHistory = withHistory && sameExploration(explorationRef.current, keyOf(req))
      const body: PlanRequest = sendHistory ? { ...req, seen: seenRef.current, exclude: selectedId ? [selectedId] : [] } : req
      setLastRequest(req)
      setStatus('loading')
      setError(null)
      setAnotherState('idle')
      if (!isDesktop) setSheet('half')
      try {
        const res = await api.plan(body, ctl.signal)
        if (ctl.signal.aborted) return
        accept(req, res)
        if (sendHistory && res.status === 'exhausted') setAnotherState('exhausted')
        setStatus('success')
      } catch (err) {
        if (ctl.signal.aborted) return
        setError(err instanceof ApiError ? err : new ApiError('network', String(err)))
        setStatus('error')
      }
    },
    [accept, isDesktop, selectedId],
  )

  const another = useCallback(async () => {
    if (!lastRequest || !response || anotherState === 'loading') return
    setAnotherState('loading')
    setAnotherError(null)
    const ctl = new AbortController()
    abortRef.current?.abort()
    abortRef.current = ctl
    try {
      const res = await api.plan({ ...lastRequest, seen: seenRef.current, exclude: selectedId ? [selectedId] : [] }, ctl.signal)
      if (ctl.signal.aborted) return
      if (res.status === 'ok' && res.options.length) {
        accept(lastRequest, res)
        setAnotherState('idle')
        if (!isDesktop) setSheet('peek')
      } else {
        // Keep the current routes on screen and explain that nothing new remains.
        setResponse((prev) => (prev ? { ...prev, suggestions: res.suggestions } : prev))
        setAnotherState('exhausted')
      }
    } catch (err) {
      if (ctl.signal.aborted) return
      setAnotherError(err instanceof ApiError ? err : new ApiError('network', String(err)))
      setAnotherState('error')
    }
  }, [accept, anotherState, isDesktop, lastRequest, response, selectedId])

  const buildRequest = useCallback(
    (o: Partial<{ query: string; minutes: number; transport: Transport; language: Language; categories: IntentId[]; radius: number }> = {}) => {
      const q = (o.query ?? query).trim()
      if (!origin) {
        setFormError('needOrigin')
        return null
      }
      if (!q) {
        setFormError('needQuery')
        return null
      }
      setFormError(null)
      const req: PlanRequest = {
        query: q.slice(0, 500),
        lat: Number(origin.lat.toFixed(5)),
        lon: Number(origin.lon.toFixed(5)),
        max_minutes: o.minutes ?? minutes,
        language: o.language ?? lang,
        transport: o.transport ?? transport,
      }
      if (o.categories?.length) req.categories = o.categories
      if (o.radius) req.radius_level = o.radius
      return req
    },
    [query, origin, minutes, lang, transport],
  )

  const submit = (o?: Parameters<typeof buildRequest>[0]) => {
    const req = buildRequest(o)
    if (req) void run(req)
  }

  // A shared link with a preset origin and a query runs once on load.
  const autoRan = useRef(false)
  useEffect(() => {
    if (autoRan.current || !sharedPreset || !shared.query) return
    autoRan.current = true
    submit()
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Switching language re-runs the last request so explanations match the UI language.
  const prevLang = useRef(lang)
  useEffect(() => {
    if (prevLang.current === lang) return
    prevLang.current = lang
    if (lastRequest && status === 'success') void run({ ...lastRequest, language: lang })
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [lang])

  const setPreset = (id: string) => {
    const p = ORIGIN_PRESETS.find((o) => o.id === id)
    if (!p) return
    setOrigin({ lat: p.lat, lon: p.lon })
    setOriginKind({ kind: 'preset', id })
    setFormError(null)
  }

  const setAddress = (r: GeocodeResult) => {
    setOrigin({ lat: r.lat, lon: r.lon })
    setOriginKind({ kind: 'address', label: r.name })
    setFormError(null)
  }

  const locate = () => {
    if (!('geolocation' in navigator) || !window.isSecureContext) {
      setGeoState('unavailable')
      return
    }
    setGeoState('locating')
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setOrigin({ lat: pos.coords.latitude, lon: pos.coords.longitude })
        setOriginKind({ kind: 'device' })
        setGeoState('idle')
        setFormError(null)
      },
      (err) => setGeoState(err.code === err.PERMISSION_DENIED ? 'denied' : 'unavailable'),
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 60_000 },
    )
  }

  const onMapClick = useCallback(
    (p: LatLon) => {
      setOrigin(p)
      setOriginKind({ kind: 'map' })
      setOriginName(null)
      setFormError(null)
      // Name the picked point for the user; failure just keeps the generic label.
      api
        .reverseGeocode(p.lat, p.lon, lang)
        .then((r) => setOriginName(r.name))
        .catch(() => undefined)
    },
    [lang],
  )

  const onSuggestion = (s: Suggestion) => {
    if (!lastRequest) return
    if (s === 'expand_radius') {
      void run({ ...lastRequest, radius_level: Math.min(2, (lastRequest.radius_level ?? 0) + 1) }, true)
    } else if (s === 'longer_time') {
      const m = Math.min(240, minutes + 60)
      setMinutes(m)
      submit({ minutes: m })
    } else {
      if (!isDesktop) setSheet('full')
      queryRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' })
      const target = s === 'change_transport' ? '[data-testid^="transport-"]' : 'textarea'
      queryRef.current?.querySelector<HTMLElement>(target)?.focus({ preventScroll: true })
    }
  }

  const share = async () => {
    const url = buildShareUrl(window.location, {
      query: lastRequest?.query ?? query,
      minutes,
      transport,
      lang,
      origin: originKind?.kind === 'preset' ? originKind.id : undefined,
    })
    try {
      await navigator.clipboard.writeText(url)
      return true
    } catch {
      window.history.replaceState(null, '', url)
      return false
    }
  }

  const selectRoute = (id: string, from: 'card' | 'map') => {
    setSelectedId(id)
    if (!isDesktop) setSheet(from === 'card' ? 'peek' : 'half')
  }

  const options = response?.options ?? []
  const selected = options.find((o) => o.id === selectedId)
  const sheetHeights: Record<SheetState, number> = { peek: 168, half: Math.round(viewportHeight * 0.55), full: Math.round(viewportHeight * 0.9) }
  const bottomInset = isDesktop ? 0 : sheet === 'full' ? 0 : sheetHeights[sheet]

  const panel = (
    <div className="space-y-5">
      {config.state === 'failed' && (
        <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-950">
          {t('error_network')}{' '}
          <button type="button" className="font-semibold underline" onClick={loadConfig}>
            {t('retry')}
          </button>
        </div>
      )}
      <div ref={queryRef}>
        <SearchForm
          query={query}
          minutes={minutes}
          transport={transport}
          origin={origin}
          originKind={originKind}
          originName={originName}
          geoState={geoState}
          loading={status === 'loading'}
          formError={formError}
          onQuery={setQuery}
          onMinutes={setMinutes}
          onTransport={setTransport}
          onPreset={setPreset}
          onAddress={setAddress}
          onLocate={locate}
          onExample={(q) => {
            setQuery(q)
            submit({ query: q })
          }}
          onSubmit={() => submit()}
          onQueryFocus={() => !isDesktop && setSheet('full')}
        />
      </div>
      <section ref={resultsRef} aria-label={t('resultsTitle')} data-testid="results" className="scroll-mt-4">
        <ResultsPanel
          status={status}
          response={response}
          error={error}
          selectedId={selectedId}
          anotherState={anotherState}
          anotherError={anotherError}
          onSelect={(id) => selectRoute(id, 'card')}
          onAnother={() => void another()}
          onRetry={() => lastRequest && void run(lastRequest)}
          onChoice={(c) => submit({ categories: [c] })}
          onSuggestion={onSuggestion}
          onShare={share}
        />
      </section>
      <p className="text-xs leading-relaxed text-slate-500" data-testid="privacy-note">
        <span aria-hidden="true">🔒 </span>
        {t('privacy')}
        {config.data?.google_client_id && !user && <> {t('authOptional')}</>}
      </p>
    </div>
  )

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-slate-50 text-slate-900">
      <a href="#panel" className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-[2000] focus:rounded-lg focus:bg-white focus:px-3 focus:py-2">
        {t('skipToPanel')}
      </a>
      <header className="z-[1100] flex shrink-0 items-center gap-2 border-b border-slate-200 bg-white px-3 py-2 sm:gap-3 sm:px-4">
        <div className="flex min-w-0 items-center gap-2.5">
          <span aria-hidden="true" className="grid size-9 shrink-0 place-items-center rounded-xl bg-slate-900 font-display text-lg font-extrabold text-amber-300">
            Q
          </span>
          <div className="min-w-0">
            <h1 className="font-display text-lg leading-tight font-extrabold tracking-tight whitespace-nowrap">{t('appName')}</h1>
            <p className="hidden truncate text-xs text-slate-500 lg:block">{t('tagline')}</p>
          </div>
        </div>
        <div className="ml-auto flex min-w-0 items-center gap-2">
          <label className="sr-only" htmlFor="lang">
            {t('languageLabel')}
          </label>
          <select
            id="lang"
            value={lang}
            onChange={(e) => setLang(e.target.value as Language)}
            className="min-h-10 rounded-lg border border-slate-300 bg-white px-2 text-sm font-medium focus:ring-2 focus:ring-sky-700/30 focus:outline-none"
            data-testid="lang-select"
          >
            {LANGUAGES.map((l) => (
              <option key={l.id} value={l.id}>
                {l.label}
              </option>
            ))}
          </select>
          <AuthControl
            clientId={config.data?.google_client_id ?? null}
            user={user}
            restored={sessionRestored}
            lang={lang}
            compact={!isDesktop}
            onUser={setUser}
          />
        </div>
      </header>

      <main className="relative min-h-0 flex-1 md:grid md:grid-cols-[minmax(380px,460px)_1fr]">
        {isDesktop && (
          <aside id="panel" className="min-h-0 overflow-y-auto border-r border-slate-200 bg-slate-50 p-5">
            {panel}
          </aside>
        )}

        <div className="absolute inset-0 md:relative">
          {config.state !== 'loading' && (
            <MapView
              mapKey={config.data?.twogis_map_key ?? null}
              lang={lang}
              origin={origin}
              options={options}
              places={response?.places ?? []}
              selectedId={selectedId}
              onMapClick={onMapClick}
              onSelect={(id) => selectRoute(id, 'map')}
              bottomInset={bottomInset}
              copyrightTop={!isDesktop}
            />
          )}
        </div>

        {!isDesktop && (
          <section
            id="panel"
            className="absolute inset-x-0 bottom-0 z-[1050] flex flex-col rounded-t-3xl bg-slate-50 shadow-[0_-8px_30px_rgba(15,23,42,0.18)] transition-[height] duration-300 motion-reduce:transition-none"
            style={{ height: sheetHeights[sheet], paddingBottom: 'env(safe-area-inset-bottom)' }}
            data-testid="bottom-sheet"
            data-state={sheet}
          >
            <button
              type="button"
              className="flex min-h-12 shrink-0 flex-col items-center gap-1 px-4 pt-2 pb-1"
              onClick={() => setSheet(sheet === 'full' ? 'peek' : sheet === 'peek' ? 'half' : 'full')}
              aria-label={sheet === 'full' ? t('collapseSheet') : t('expandSheet')}
              aria-expanded={sheet !== 'peek'}
              aria-controls="panel-content"
              data-testid="sheet-handle"
            >
              <span aria-hidden="true" className="h-1.5 w-12 rounded-full bg-slate-300" />
              <span className="max-w-full truncate text-xs font-semibold text-slate-700">
                {selected
                  ? `${selected.title} · ${t('travelValue', { n: selected.travel_minutes, d: formatDistance(selected.travel_distance_m, locale) })}`
                  : sheet === 'full'
                    ? t('showMap')
                    : t('showResults')}
              </span>
            </button>
            <div id="panel-content" className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-6">
              {panel}
            </div>
          </section>
        )}
      </main>
    </div>
  )
}
