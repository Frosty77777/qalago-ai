import { useState } from 'react'
import { ApiError } from '../api/client'
import type { IntentId, Place, PlanResponse, Suggestion } from '../api/types'
import { useI18n } from '../i18n/I18nContext'
import { errorMessage } from '../lib/errors'
import { formatDistance } from '../lib/geo'
import type { StringKey } from '../i18n/strings'
import { RouteCard } from './RouteCard'

interface Props {
  status: 'idle' | 'loading' | 'success' | 'error'
  response: PlanResponse | null
  error: ApiError | null
  selectedId: string | null
  /** "Another route" outcome shown above the current cards. */
  anotherState: 'idle' | 'loading' | 'exhausted' | 'error'
  anotherError: ApiError | null
  onSelect: (id: string) => void
  onAnother: () => void
  onRetry: () => void
  onChoice: (c: IntentId) => void
  onSuggestion: (s: Suggestion) => void
  onShare: () => Promise<boolean>
}

function Skeleton() {
  return (
    <div className="space-y-3" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <div key={i} className="animate-pulse rounded-2xl border border-slate-200 bg-white p-4">
          <div className="h-5 w-2/3 rounded bg-slate-200" />
          <div className="mt-3 h-4 w-1/2 rounded bg-slate-100" />
          <div className="mt-3 h-12 w-full rounded-xl bg-slate-100" />
        </div>
      ))}
    </div>
  )
}

function PlaceCard({ place }: { place: Place }) {
  const { t, category, locale } = useI18n()
  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-4 text-sm shadow-sm" data-testid="place-card">
      <h3 className="font-display text-base font-bold break-words text-slate-900">{place.name}</h3>
      <p className="text-xs text-slate-600">
        {place.rubric ?? category(place.category)}
        {place.address && ` · ${place.address}`}
      </p>
      <p className="mt-2 flex flex-wrap gap-1.5 text-xs">
        <span className="badge bg-slate-100 text-slate-800 ring-slate-300">{t('straightLine', { d: formatDistance(place.straight_distance_m, locale) })}</span>
        <span className="badge bg-white text-slate-800 ring-slate-200">
          {place.rating != null ? t('rating', { r: place.rating.toFixed(1), c: place.review_count }) : t('noRating')}
        </span>
        <span className="badge bg-white text-slate-800 ring-slate-200">
          {place.hours_status === 'open' ? (place.closes_at ? t('hours_open', { t: place.closes_at }) : t('hours_open_nt')) : t('hours_unknown')}
        </span>
      </p>
      <a className="mt-2 inline-block text-xs font-medium text-sky-800 underline underline-offset-2" href={place.source_url} target="_blank" rel="noreferrer">
        {t('openIn2gis')}&nbsp;↗
      </a>
    </article>
  )
}

function Suggestions({ items, onSuggestion }: { items: Suggestion[]; onSuggestion: (s: Suggestion) => void }) {
  const { t } = useI18n()
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {items.map((s) => (
        <button key={s} type="button" className="chip" onClick={() => onSuggestion(s)} data-testid={`suggestion-${s}`}>
          {t(`suggestion_${s}`)}
        </button>
      ))}
    </div>
  )
}

export function ResultsPanel(props: Props) {
  const { t, category } = useI18n()
  const { status, response, error, selectedId } = props
  const [copied, setCopied] = useState(false)

  if (status === 'idle') {
    return (
      <div className="rounded-2xl border border-dashed border-slate-300 bg-white/60 p-5 text-center">
        <p className="font-display text-base font-bold text-slate-900">{t('idleTitle')}</p>
        <p className="mt-1 text-sm text-slate-600">{t('idleBody')}</p>
      </div>
    )
  }

  if (status === 'loading') {
    return (
      <div role="status" aria-live="polite">
        <span className="sr-only">{t('searching')}</span>
        <Skeleton />
      </div>
    )
  }

  if (status === 'error' && error) {
    return (
      <div role="alert" data-testid="error-state" className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-950">
        <p className="font-semibold">{errorMessage(t, error)}</p>
        {error.kind !== 'validation' && error.kind !== 'not_configured' && (
          <button type="button" className="btn-secondary mt-3" onClick={props.onRetry}>
            {t('retry')}
          </button>
        )}
      </div>
    )
  }

  if (!response) return null
  const interp = response.interpretation

  if (response.status === 'clarify') {
    return (
      <section className="rounded-2xl border border-sky-200 bg-white p-4" data-testid="clarify" aria-labelledby="clarify-title">
        <h2 id="clarify-title" className="font-display text-base font-bold text-slate-900">
          {t('clarifyTitle')}
        </h2>
        <p className="mt-1 text-sm text-slate-700">{response.question}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {response.choices.map((c) => (
            <button key={c} type="button" className="chip" onClick={() => props.onChoice(c)} data-testid={`choice-${c}`}>
              {category(c)}
            </button>
          ))}
        </div>
      </section>
    )
  }

  return (
    <div className="space-y-3" aria-live="polite">
      {interp && (
        <p className="text-xs text-slate-600" data-testid="interpretation">
          {t('interpretedAs', { c: interp.categories.map((c) => (c === 'place' && interp.free_text ? `«${interp.free_text}»` : category(c))).join(' + ') })}
          {' · '}
          {t(`transport_${interp.transport}`)} · {t('budgetLabel', { n: interp.budget_minutes })}
        </p>
      )}

      {response.status === 'routing_unavailable' ? (
        <div className="space-y-3" data-testid="routing-unavailable">
          <p role="alert" className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
            {t('routingDown', {
              reason: t(
                (['rate_limited', 'key_rejected', 'unavailable'].includes(response.routing_error?.kind ?? '')
                  ? `routingReason_${response.routing_error?.kind}`
                  : 'routingReason_other') as StringKey,
              ),
            })}
          </p>
          {response.places.map((p) => (
            <PlaceCard key={p.id} place={p} />
          ))}
          <button type="button" className="btn-secondary w-full" onClick={props.onRetry}>
            {t('retry')}
          </button>
        </div>
      ) : response.status === 'empty' ? (
        <div data-testid="empty-state" className="rounded-2xl border border-slate-200 bg-white p-5">
          <p className="font-display text-base font-bold text-slate-900">{t('emptyTitle')}</p>
          <p className="mt-1 text-sm text-slate-600">{t('emptyBody')}</p>
          <Suggestions items={response.suggestions} onSuggestion={props.onSuggestion} />
        </div>
      ) : (
        <>
          <div className="flex items-end justify-between gap-3">
            <div>
              <h2 className="font-display text-xl font-extrabold tracking-tight text-slate-900">{t('resultsTitle')}</h2>
              <p className="text-xs text-slate-500">{t('resultsCount', { n: response.options.length })}</p>
            </div>
          </div>

          <button
            type="button"
            className="btn-primary w-full"
            onClick={props.onAnother}
            disabled={props.anotherState === 'loading'}
            aria-busy={props.anotherState === 'loading'}
            data-testid="another-route"
          >
            <span aria-hidden="true">↻</span> {props.anotherState === 'loading' ? t('anotherRouteLoading') : t('anotherRoute')}
          </button>
          {props.anotherState === 'exhausted' && (
            <div role="status" data-testid="exhausted" className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
              <p className="font-semibold">{t('exhaustedTitle')}</p>
              <p className="mt-1">{t('exhaustedBody')}</p>
              <Suggestions items={response.suggestions} onSuggestion={props.onSuggestion} />
            </div>
          )}
          {props.anotherState === 'error' && props.anotherError && (
            <p role="alert" className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-950">
              {errorMessage(t, props.anotherError)}
            </p>
          )}

          <ol className="space-y-3">
            {response.options.map((option, i) => (
              <li key={option.id}>
                <RouteCard option={option} index={i} selected={option.id === selectedId} onSelect={() => props.onSelect(option.id)} />
              </li>
            ))}
          </ol>
        </>
      )}

      {response.notices.length > 0 && (
        <details className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700" data-testid="notices">
          <summary className="cursor-pointer font-semibold text-slate-800">
            {t('noticesTitle')} · {response.notices.length}
          </summary>
          <ul className="mt-1 list-disc space-y-1 pl-5">
            {response.notices.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </details>
      )}
      {response.ranking_note && (
        <details className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700">
          <summary className="cursor-pointer font-semibold text-slate-800">{t('howRanked')}</summary>
          <p className="mt-1">{response.ranking_note}</p>
        </details>
      )}
      {response.options.length > 0 && (
        <button
          type="button"
          className="btn-secondary w-full"
          onClick={async () => {
            if (await props.onShare()) {
              setCopied(true)
              setTimeout(() => setCopied(false), 2000)
            }
          }}
        >
          {copied ? t('copied') : t('share')}
        </button>
      )}
      <p className="text-xs text-slate-500">{t('attribution')}</p>
    </div>
  )
}
