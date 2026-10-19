import type { FormEvent } from 'react'
import { useI18n } from '../i18n/I18nContext'
import type { StringKey } from '../i18n/strings'
import { MODE_IDS, ORIGIN_PRESETS, SCENARIOS, type ModeId, type ScenarioId } from '../lib/presets'

export type OriginKind = { kind: 'preset'; id: string } | { kind: 'map' } | { kind: 'device' } | null

interface Props {
  query: string
  minutes: number
  mode: ModeId
  origin: OriginKind
  geoState: 'idle' | 'locating' | 'denied' | 'unavailable'
  loading: boolean
  formError: StringKey | null
  activeScenario: ScenarioId | null
  onQuery: (q: string) => void
  onMinutes: (m: number) => void
  onMode: (m: ModeId) => void
  onPreset: (id: string) => void
  onLocate: () => void
  onScenario: (id: ScenarioId) => void
  onSubmit: () => void
}

export function SearchForm(props: Props) {
  const { t, lang } = useI18n()
  const { query, minutes, mode, origin, geoState, loading, formError, activeScenario } = props

  const submit = (e: FormEvent) => {
    e.preventDefault()
    props.onSubmit()
  }

  const originText =
    origin?.kind === 'preset'
      ? ORIGIN_PRESETS.find((p) => p.id === origin.id)?.label[lang]
      : origin?.kind === 'map'
        ? t('originCustom')
        : origin?.kind === 'device'
          ? t('originMine')
          : t('originNone')

  return (
    <form onSubmit={submit} className="space-y-4" aria-describedby={formError ? 'form-error' : undefined}>
      <fieldset className="space-y-2">
        <legend className="field-label">{t('originTitle')}</legend>
        <p className="flex items-center gap-2 text-sm text-slate-700" data-testid="origin-status">
          <span aria-hidden="true" className={`size-2.5 rounded-full ${origin ? 'bg-amber-400 ring-4 ring-amber-100' : 'bg-slate-300'}`} />
          {originText}
        </p>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={props.onLocate} className="btn-secondary" disabled={geoState === 'locating'} aria-pressed={origin?.kind === 'device'}>
            <span aria-hidden="true">◎</span> {geoState === 'locating' ? t('locating') : t('useMyLocation')}
          </button>
          {ORIGIN_PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              className="chip"
              aria-pressed={origin?.kind === 'preset' && origin.id === p.id}
              onClick={() => props.onPreset(p.id)}
              data-testid={`origin-${p.id}`}
            >
              {p.label[lang]}
            </button>
          ))}
        </div>
        {(geoState === 'denied' || geoState === 'unavailable') && (
          <p role="status" className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
            {t(geoState === 'denied' ? 'geoDenied' : 'geoUnavailable')}
          </p>
        )}
        <p className="text-xs text-slate-500">{t('pickOnMapHint')}</p>
      </fieldset>

      <fieldset>
        <legend className="field-label">{t('scenariosTitle')}</legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {SCENARIOS.map((s) => (
            <button
              key={s.id}
              type="button"
              className="chip"
              aria-pressed={activeScenario === s.id}
              onClick={() => props.onScenario(s.id)}
              data-testid={`scenario-${s.id}`}
            >
              {t(`scenario_${s.id}`)}
            </button>
          ))}
        </div>
      </fieldset>

      <div>
        <label htmlFor="query" className="field-label">
          {t('queryLabel')}
        </label>
        <textarea
          id="query"
          rows={2}
          maxLength={500}
          value={query}
          onChange={(e) => props.onQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              props.onSubmit()
            }
          }}
          placeholder={t('queryPlaceholder')}
          className="mt-1.5 w-full resize-none rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-base text-slate-900 placeholder:text-slate-400 focus:border-sky-700 focus:ring-2 focus:ring-sky-700/30 focus:outline-none"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_auto]">
        <div>
          <div className="flex items-baseline justify-between">
            <label htmlFor="minutes" className="field-label">
              {t('durationLabel')}
            </label>
            <output htmlFor="minutes" className="font-display text-sm font-bold text-slate-900" data-testid="minutes-value">
              {t('minutes', { n: minutes })}
            </output>
          </div>
          <input
            id="minutes"
            type="range"
            min={15}
            max={240}
            step={15}
            value={minutes}
            onChange={(e) => props.onMinutes(Number(e.target.value))}
            className="mt-2 w-full accent-sky-800"
          />
        </div>
      </div>

      <fieldset>
        <legend className="field-label">{t('modeLabel')}</legend>
        <div className="mt-2 grid grid-cols-5 gap-1 rounded-xl bg-slate-100 p-1" role="radiogroup">
          {MODE_IDS.map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={mode === m}
              onClick={() => props.onMode(m)}
              className={`min-h-10 rounded-lg px-1 text-xs font-semibold transition-colors sm:text-sm ${mode === m ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
            >
              {t(`mode_${m}`)}
            </button>
          ))}
        </div>
      </fieldset>

      {formError && (
        <p id="form-error" role="alert" className="text-sm font-medium text-rose-700">
          {t(formError)}
        </p>
      )}

      <button type="submit" className="btn-primary w-full" disabled={loading} data-testid="search-submit">
        {loading ? t('searching') : t('search')}
      </button>
    </form>
  )
}
