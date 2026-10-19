import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { API_BASE_URL, ApiError, getApi, MOCKS_FORCED } from './api/client'
import type { Health, Language, Poi, RecommendRequest, RecommendResponse } from './api/types'
import { MapView } from './components/MapView'
import { ResultsPanel, type ReplanKind } from './components/ResultsPanel'
import { SearchForm, type OriginKind } from './components/SearchForm'
import { useI18n } from './i18n/I18nContext'
import { LANGUAGES, type StringKey } from './i18n/strings'
import type { LatLon } from './lib/geo'
import { FLIGHT_PATTERN, MODES, ORIGIN_PRESETS, SCENARIOS, type ModeId, type ScenarioId } from './lib/presets'
import { readShareParams, buildShareUrl } from './lib/share'

type Status = 'idle' | 'loading' | 'success' | 'error'
type SheetState = 'peek' | 'half' | 'full'

const QUIET_PATTERN = /quiet|outlet|socket|тих|розетк|тыныш/i
const EVENING_PATTERN = /evening|night|вечер|ноч|кеш|түн/i
const NATURE_PREFS = ['nature', 'park', 'garden']
const INDOOR_PREFS = ['indoors', 'museum', 'library', 'cafe']

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

function noticesFor(req: RecommendRequest | null): StringKey[] {
  if (!req) return []
  const text = `${req.query} ${(req.preferences ?? []).join(' ')}`
  const out: StringKey[] = []
  if (FLIGHT_PATTERN.test(req.query)) out.push('flightNotice')
  if (QUIET_PATTERN.test(text)) out.push('quietNotice')
  if (EVENING_PATTERN.test(text)) out.push('eveningNotice')
  return out
}

const unique = (xs: string[]) => [...new Set(xs)]

export default function App() {
  const { t, lang, setLang, category } = useI18n()
  const isDesktop = useIsDesktop()
  const shared = useMemo(() => readShareParams(window.location.search), [])

  const [demoMode, setDemoMode] = useState(MOCKS_FORCED)
  const api = useMemo(() => getApi(demoMode), [demoMode])

  const [health, setHealth] = useState<{ state: 'checking' | 'ok' | 'down'; data?: Health }>({ state: 'checking' })
  const [pois, setPois] = useState<Poi[]>([])
  const [showLayer, setShowLayer] = useState(true)
  const [categoryFilter, setCategoryFilter] = useState<string>('all')

  const sharedPreset = ORIGIN_PRESETS.find((p) => p.id === shared.origin)
  const [origin, setOrigin] = useState<LatLon | null>(sharedPreset ? { lat: sharedPreset.lat, lon: sharedPreset.lon } : null)
  const [originKind, setOriginKind] = useState<OriginKind>(sharedPreset ? { kind: 'preset', id: sharedPreset.id } : null)
  const [geoState, setGeoState] = useState<'idle' | 'locating' | 'denied' | 'unavailable'>('idle')

  const [query, setQuery] = useState(shared.query ?? '')
  const [minutes, setMinutes] = useState(shared.minutes ?? 60)
  const [mode, setMode] = useState<ModeId>(shared.mode ?? 'walk')
  const [extraPrefs, setExtraPrefs] = useState<string[]>([])
  const [activeScenario, setActiveScenario] = useState<ScenarioId | null>(null)
  const [formError, setFormError] = useState<StringKey | null>(null)

  const [status, setStatus] = useState<Status>('idle')
  const [response, setResponse] = useState<RecommendResponse | null>(null)
  const [error, setError] = useState<ApiError | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [lastRequest, setLastRequest] = useState<RecommendRequest | null>(null)
  const [sheet, setSheet] = useState<SheetState>('half')

  const abortRef = useRef<AbortController | null>(null)
  const queryRef = useRef<HTMLDivElement | null>(null)
  const resultsRef = useRef<HTMLElement | null>(null)

  // Bring new results (or an error) into view inside the scrolling panel.
  useEffect(() => {
    if (status === 'success' || status === 'error') resultsRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }, [status, response])

  // Backend health + collected POIs for the background layer.
  useEffect(() => {
    const ctl = new AbortController()
    setHealth({ state: 'checking' })
    api
      .health(ctl.signal)
      .then((data) => setHealth({ state: 'ok', data }))
      .catch(() => !ctl.signal.aborted && setHealth({ state: 'down' }))
    api
      .pois(ctl.signal)
      .then((list) => setPois(Array.isArray(list) ? list.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon)) : []))
      .catch(() => !ctl.signal.aborted && setPois([]))
    return () => ctl.abort()
  }, [api])

  const run = useCallback(
    async (req: RecommendRequest) => {
      abortRef.current?.abort()
      const ctl = new AbortController()
      abortRef.current = ctl
      setLastRequest(req)
      setStatus('loading')
      setError(null)
      setSelectedId(null)
      if (!isDesktop) setSheet('half')
      try {
        const res = await api.recommend(req, ctl.signal)
        if (ctl.signal.aborted) return
        setResponse(res)
        setStatus('success')
      } catch (err) {
        if (ctl.signal.aborted) return
        setError(err instanceof ApiError ? err : new ApiError('network', String(err)))
        setStatus('error')
      }
    },
    [api, isDesktop],
  )

  const buildRequest = useCallback(
    (overrides: Partial<{ query: string; minutes: number; mode: ModeId; extra: string[]; language: Language }> = {}): RecommendRequest | null => {
      const q = (overrides.query ?? query).trim()
      if (!origin) {
        setFormError('needOrigin')
        return null
      }
      if (!q) {
        setFormError('needQuery')
        return null
      }
      setFormError(null)
      const m = overrides.mode ?? mode
      return {
        query: q.slice(0, 500),
        lat: Number(origin.lat.toFixed(5)),
        lon: Number(origin.lon.toFixed(5)),
        max_minutes: overrides.minutes ?? minutes,
        language: overrides.language ?? lang,
        mode: MODES[m].api,
        preferences: unique([...MODES[m].preferences, ...(overrides.extra ?? extraPrefs)]),
      }
    },
    [query, origin, mode, minutes, lang, extraPrefs],
  )

  const submit = (overrides?: Parameters<typeof buildRequest>[0]) => {
    const req = buildRequest(overrides)
    if (req) void run(req)
  }

  // Shared link with a preset origin and a query runs once on load.
  const autoRan = useRef(false)
  useEffect(() => {
    if (autoRan.current || !sharedPreset || !shared.query) return
    autoRan.current = true
    submit()
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Switching language re-runs the last successful request so generated text matches the UI.
  const prevLang = useRef(lang)
  useEffect(() => {
    if (prevLang.current === lang) return
    const old = prevLang.current
    prevLang.current = lang
    const scenario = SCENARIOS.find((s) => s.id === activeScenario)
    if (scenario && query === scenario.query[old]) setQuery(scenario.query[lang])
    if (lastRequest && status !== 'loading') {
      const q = scenario && lastRequest.query === scenario.query[old] ? scenario.query[lang] : lastRequest.query
      void run({ ...lastRequest, language: lang, query: q })
    }
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [lang])

  // Re-run after an explicit switch to demo data.
  const pendingDemoRetry = useRef(false)
  useEffect(() => {
    if (pendingDemoRetry.current && lastRequest) {
      pendingDemoRetry.current = false
      void run(lastRequest)
    }
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [api])

  const setPreset = (id: string) => {
    const p = ORIGIN_PRESETS.find((o) => o.id === id)
    if (!p) return
    setOrigin({ lat: p.lat, lon: p.lon })
    setOriginKind({ kind: 'preset', id })
    setFormError(null)
  }

  const locate = () => {
    if (!('geolocation' in navigator)) {
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

  const onMapClick = useCallback((p: LatLon) => {
    setOrigin(p)
    setOriginKind({ kind: 'map' })
    setFormError(null)
  }, [])

  const applyScenario = (id: ScenarioId) => {
    const s = SCENARIOS.find((x) => x.id === id)
    if (!s) return
    setActiveScenario(id)
    setQuery(s.query[lang])
    setMinutes(s.minutes)
    setMode(s.mode)
    setExtraPrefs(s.extraPreferences)
    submit({ query: s.query[lang], minutes: s.minutes, mode: s.mode, extra: s.extraPreferences })
  }

  const replan = (k: ReplanKind) => {
    if (k === 'shorter') {
      const m = Math.max(15, Math.round((minutes * 0.6) / 15) * 15)
      setMinutes(m)
      submit({ minutes: m })
      return
    }
    const add = k === 'nature' ? NATURE_PREFS : INDOOR_PREFS
    const remove = k === 'nature' ? INDOOR_PREFS : NATURE_PREFS
    const extra = unique([...extraPrefs.filter((p) => !remove.includes(p)), ...add])
    setExtraPrefs(extra)
    submit({ extra })
  }

  const onEmptyAction = (a: 'longer' | 'origin' | 'rephrase') => {
    if (a === 'longer') {
      const m = Math.min(240, minutes + 60)
      setMinutes(m)
      submit({ minutes: m })
    } else if (a === 'origin') {
      if (!isDesktop) setSheet('peek')
    } else {
      setSheet(isDesktop ? sheet : 'full')
      queryRef.current?.querySelector('textarea')?.focus()
    }
  }

  const share = async () => {
    const url = buildShareUrl(window.location, {
      query: lastRequest?.query ?? query,
      minutes,
      mode,
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

  const originLabel =
    originKind?.kind === 'preset'
      ? (ORIGIN_PRESETS.find((p) => p.id === originKind.id)?.label[lang] ?? '')
      : originKind?.kind === 'device'
        ? t('originMine')
        : t('originCustom')

  const categories = useMemo(() => [...new Set(pois.map((p) => p.category))].sort(), [pois])
  const visiblePois = useMemo(
    () => (showLayer ? pois.filter((p) => categoryFilter === 'all' || p.category === categoryFilter) : []),
    [pois, showLayer, categoryFilter],
  )

  const sheetHeights: Record<SheetState, string> = { peek: '9.5rem', half: '55dvh', full: '90dvh' }
  const bottomInset = isDesktop ? 0 : sheet === 'peek' ? 160 : sheet === 'half' ? Math.round(window.innerHeight * 0.55) : 0

  const panel = (
    <div className="space-y-5">
      <div ref={queryRef}>
        <SearchForm
          query={query}
          minutes={minutes}
          mode={mode}
          origin={originKind}
          geoState={geoState}
          loading={status === 'loading'}
          formError={formError}
          activeScenario={activeScenario}
          onQuery={(q) => {
            setQuery(q)
            setActiveScenario(null)
          }}
          onMinutes={setMinutes}
          onMode={setMode}
          onPreset={setPreset}
          onLocate={locate}
          onScenario={applyScenario}
          onSubmit={() => submit()}
        />
      </div>
      <section ref={resultsRef} aria-label={t('resultsTitle')} data-testid="results" className="scroll-mt-4">
        <ResultsPanel
          status={status}
          response={response}
          error={error}
          apiBaseUrl={API_BASE_URL}
          selectedId={selectedId}
          budgetMinutes={lastRequest?.max_minutes ?? minutes}
          originLabel={originLabel}
          notices={noticesFor(lastRequest)}
          canUseDemo={!demoMode}
          onSelect={(id) => {
            setSelectedId(id)
            if (!isDesktop) setSheet('peek')
          }}
          onRetry={() => lastRequest && void run(lastRequest)}
          onUseDemo={() => {
            pendingDemoRetry.current = true
            setDemoMode(true)
          }}
          onReplan={replan}
          onShare={share}
          onEmptyAction={onEmptyAction}
          onEditSearch={() => {
            if (!isDesktop) setSheet('full')
            queryRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' })
            queryRef.current?.querySelector('textarea')?.focus({ preventScroll: true })
          }}
        />
      </section>
      <p className="text-xs leading-relaxed text-slate-500" data-testid="privacy-note">
        <span aria-hidden="true">🔒 </span>
        {t('privacy')}
      </p>
    </div>
  )

  const healthPill =
    health.state === 'checking' ? (
      <span className="pill bg-slate-100 text-slate-600">{t('healthChecking')}</span>
    ) : health.state === 'down' ? (
      <span className="pill bg-rose-100 text-rose-900" data-testid="health-down">
        {t('healthDown')}
      </span>
    ) : (
      <span className="pill bg-emerald-50 text-emerald-900" data-testid="health-ok">
        {t('healthPlaces', { n: health.data?.poi_count ?? 0 })} · {health.data?.llm_enabled ? t('healthAiOn') : t('healthAiOff')}
      </span>
    )

  return (
    <div className="flex h-dvh flex-col bg-slate-50 text-slate-900">
      <a href="#panel" className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-[2000] focus:rounded-lg focus:bg-white focus:px-3 focus:py-2">
        {t('queryLabel')}
      </a>
      <header className="z-[1100] flex shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-2.5">
          <span aria-hidden="true" className="grid size-9 shrink-0 place-items-center rounded-xl bg-slate-900 font-display text-lg font-extrabold text-amber-300">
            Q
          </span>
          <div className="min-w-0">
            <h1 className="font-display text-lg leading-tight font-extrabold tracking-tight whitespace-nowrap">{t('appName')}</h1>
            <p className="hidden truncate text-xs text-slate-500 sm:block">{t('tagline')}</p>
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {demoMode && (
            <span className="pill bg-fuchsia-600 text-white" title={t('demoExplain')} data-testid="demo-badge">
              {t('demoBadge')}
            </span>
          )}
          <span className="hidden lg:inline-flex">{healthPill}</span>
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
        </div>
      </header>

      {demoMode && (
        <div className="z-[1100] flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 bg-fuchsia-50 px-4 py-1.5 text-xs text-fuchsia-950" role="status">
          <span>{t('demoExplain')}</span>
          {!MOCKS_FORCED && (
            <button type="button" className="font-semibold underline" onClick={() => setDemoMode(false)}>
              {t('leaveDemo')}
            </button>
          )}
        </div>
      )}

      <main className="relative min-h-0 flex-1 md:grid md:grid-cols-[minmax(380px,440px)_1fr]">
        {isDesktop && (
          <aside id="panel" className="min-h-0 overflow-y-auto border-r border-slate-200 bg-slate-50 p-5">
            {panel}
          </aside>
        )}

        <div className="absolute inset-0 md:relative">
          <MapView
            origin={origin}
            recommendations={response?.recommendations ?? []}
            route={response?.route ?? null}
            selectedId={selectedId}
            backgroundPois={visiblePois}
            onMapClick={onMapClick}
            onSelect={(id) => {
              setSelectedId(id)
              if (!isDesktop) setSheet('half')
            }}
            bottomInset={bottomInset}
            attributionTop={!isDesktop}
          />
          <div className="pointer-events-none absolute top-10 left-3 z-[1000] flex max-w-[calc(100%-5rem)] flex-wrap gap-2 md:top-3">
            <label className="pointer-events-auto flex items-center gap-2 rounded-lg bg-white/95 px-2.5 py-1.5 text-xs font-medium shadow ring-1 ring-slate-200">
              <input type="checkbox" checked={showLayer} onChange={(e) => setShowLayer(e.target.checked)} className="accent-sky-800" />
              {t('layerAll')}
            </label>
            {showLayer && categories.length > 1 && (
              <select
                aria-label={t('categoryFilter')}
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
                className="pointer-events-auto rounded-lg bg-white/95 px-2 py-1.5 text-xs font-medium shadow ring-1 ring-slate-200"
              >
                <option value="all">{t('allCategories')}</option>
                {categories.map((c) => (
                  <option key={c} value={c}>
                    {category(c)}
                  </option>
                ))}
              </select>
            )}
            {!isDesktop && <span className="pointer-events-auto">{healthPill}</span>}
          </div>
        </div>

        {!isDesktop && (
          <section
            id="panel"
            className="absolute inset-x-0 bottom-0 z-[1050] flex flex-col rounded-t-3xl bg-slate-50 shadow-[0_-8px_30px_rgba(15,23,42,0.18)] transition-[height] duration-300"
            style={{ height: sheetHeights[sheet] }}
            data-testid="bottom-sheet"
            data-state={sheet}
          >
            <button
              type="button"
              className="flex shrink-0 flex-col items-center gap-1 px-4 pt-2 pb-1"
              onClick={() => setSheet(sheet === 'full' ? 'peek' : sheet === 'peek' ? 'half' : 'full')}
              aria-label={sheet === 'full' ? t('collapseSheet') : t('expandSheet')}
              aria-expanded={sheet !== 'peek'}
            >
              <span aria-hidden="true" className="h-1.5 w-12 rounded-full bg-slate-300" />
              <span className="text-xs font-semibold text-slate-600">
                {status === 'success' && response?.recommendations.length
                  ? t('resultsCount', { n: response.recommendations.length })
                  : sheet === 'full'
                    ? t('showMap')
                    : t('showResults')}
              </span>
            </button>
            <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6">{panel}</div>
          </section>
        )}
      </main>
    </div>
  )
}
