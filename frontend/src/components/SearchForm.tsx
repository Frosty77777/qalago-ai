import { useState, type FormEvent } from 'react'
import { api } from '../api/client'
import type { GeocodeResult, Transport } from '../api/types'
import { useI18n } from '../i18n/I18nContext'
import type { StringKey } from '../i18n/strings'
import type { LatLon } from '../lib/geo'
import { EXAMPLES, ORIGIN_PRESETS, TRANSPORTS } from '../lib/presets'
import { TransportIcon } from './TransportIcon'

export type OriginKind = { kind: 'preset'; id: string } | { kind: 'map' } | { kind: 'device' } | { kind: 'address'; label: string } | null

interface Props {
  query: string
  minutes: number
  transport: Transport
  origin: LatLon | null
  originKind: OriginKind
  originName: string | null
  geoState: 'idle' | 'locating' | 'denied' | 'unavailable'
  loading: boolean
  formError: StringKey | null
  onQuery: (q: string) => void
  onMinutes: (m: number) => void
  onTransport: (t: Transport) => void
  onPreset: (id: string) => void
  onAddress: (r: GeocodeResult) => void
  onLocate: () => void
  onExample: (query: string) => void
  onSubmit: () => void
  onQueryFocus: () => void
}

function AddressSearch({ near, onPick }: { near: LatLon | null; onPick: (r: GeocodeResult) => void }) {
  const { t, lang } = useI18n()
  const [text, setText] = useState('')
  const [results, setResults] = useState<GeocodeResult[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)

  const search = async () => {
    if (text.trim().length < 2 || busy) return
    setBusy(true)
    setFailed(false)
    try {
      setResults(await api.geocode(text.trim(), near, lang))
    } catch {
      setResults(null)
      setFailed(true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <label htmlFor="origin-search" className="sr-only">
        {t('originSearchLabel')}
      </label>
      <div className="flex gap-2">
        <input
          id="origin-search"
          type="search"
          enterKeyHint="search"
          autoComplete="street-address"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              void search()
            }
          }}
          placeholder={t('originSearchPlaceholder')}
          className="min-h-11 min-w-0 flex-1 rounded-xl border border-slate-300 bg-white px-3 text-base focus:border-sky-700 focus:ring-2 focus:ring-sky-700/30 focus:outline-none"
        />
        <button type="button" className="btn-secondary min-h-11" onClick={() => void search()} disabled={busy}>
          {t('originSearchButton')}
        </button>
      </div>
      {failed && (
        <p role="alert" className="mt-1 text-sm text-rose-700">
          {t('error_provider_unavailable', { service: t('service_geocoder') })}
        </p>
      )}
      {results && results.length === 0 && <p className="mt-1 text-sm text-slate-600">{t('originSearchEmpty')}</p>}
      {results && results.length > 0 && (
        <ul className="mt-1 divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white" data-testid="origin-results">
          {results.map((r) => (
            <li key={`${r.lat},${r.lon},${r.name}`}>
              <button
                type="button"
                className="block min-h-11 w-full px-3 py-2 text-left text-sm hover:bg-slate-50"
                onClick={() => {
                  onPick(r)
                  setResults(null)
                  setText(r.name)
                }}
              >
                {r.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function SearchForm(props: Props) {
  const { t, lang } = useI18n()
  const { query, minutes, transport, originKind, geoState, loading, formError } = props

  const submit = (e: FormEvent) => {
    e.preventDefault()
    props.onSubmit()
  }

  const originText =
    originKind?.kind === 'preset'
      ? ORIGIN_PRESETS.find((p) => p.id === originKind.id)?.label[lang]
      : originKind?.kind === 'address'
        ? originKind.label
        : originKind?.kind === 'map'
          ? (props.originName ?? t('originCustom'))
          : originKind?.kind === 'device'
            ? t('originMine')
            : t('originNone')

  return (
    <form onSubmit={submit} className="space-y-4" aria-describedby={formError ? 'form-error' : undefined}>
      <div>
        <label htmlFor="query" className="field-label">
          {t('queryLabel')}
        </label>
        <textarea
          id="query"
          rows={2}
          maxLength={500}
          value={query}
          enterKeyHint="search"
          onFocus={props.onQueryFocus}
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
        <div className="mt-2 flex gap-2 overflow-x-auto pb-1" role="group" aria-label={t('examplesTitle')}>
          {EXAMPLES.map((ex) => (
            <button key={ex.id} type="button" className="chip shrink-0" onClick={() => props.onExample(ex.query[lang])} data-testid={`example-${ex.id}`}>
              {ex.query[lang]}
            </button>
          ))}
        </div>
      </div>

      <fieldset className="space-y-2">
        <legend className="field-label">{t('originTitle')}</legend>
        <p className="flex items-center gap-2 text-sm text-slate-700" data-testid="origin-status">
          <span aria-hidden="true" className={`size-2.5 shrink-0 rounded-full ${originKind ? 'bg-amber-400 ring-4 ring-amber-100' : 'bg-slate-300'}`} />
          <span className="min-w-0 break-words">{originText}</span>
        </p>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={props.onLocate} className="btn-secondary" disabled={geoState === 'locating'} aria-pressed={originKind?.kind === 'device'}>
            <span aria-hidden="true">◎</span> {geoState === 'locating' ? t('locating') : t('useMyLocation')}
          </button>
          {ORIGIN_PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              className="chip"
              aria-pressed={originKind?.kind === 'preset' && originKind.id === p.id}
              onClick={() => props.onPreset(p.id)}
              data-testid={`origin-${p.id}`}
            >
              {p.label[lang]}
            </button>
          ))}
        </div>
        {(geoState === 'denied' || geoState === 'unavailable') && (
          <p role="status" className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900" data-testid="geo-denied">
            {t(geoState === 'denied' ? 'geoDenied' : 'geoUnavailable')}
          </p>
        )}
        <AddressSearch near={props.origin} onPick={props.onAddress} />
        <p className="text-xs text-slate-500">{t('pickOnMapHint')}</p>
      </fieldset>

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
          className="mt-2 h-8 w-full accent-sky-800"
        />
      </div>

      <fieldset>
        <legend className="field-label">{t('transportLabel')}</legend>
        <div className="mt-2 grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1 min-[400px]:grid-cols-4" role="group" aria-label={t('transportLabel')}>
          {TRANSPORTS.map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={transport === m}
              onClick={() => props.onTransport(m)}
              data-testid={`transport-${m}`}
              className={`flex min-h-11 items-center justify-center gap-1.5 rounded-lg px-1 text-xs font-semibold transition-colors sm:text-sm ${transport === m ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
            >
              <TransportIcon transport={m} />
              {t(`transport_${m}`)}
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
