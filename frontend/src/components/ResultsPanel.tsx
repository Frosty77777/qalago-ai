import { useState } from 'react'
import { ApiError } from '../api/client'
import type { RecommendResponse } from '../api/types'
import { useI18n } from '../i18n/I18nContext'
import type { StringKey } from '../i18n/strings'
import { Itinerary } from './Itinerary'
import { ResultCard } from './ResultCard'

export type ReplanKind = 'nature' | 'shorter' | 'indoors'

interface Props {
  status: 'idle' | 'loading' | 'success' | 'error'
  response: RecommendResponse | null
  error: ApiError | null
  apiBaseUrl: string
  selectedId: string | null
  budgetMinutes: number
  originLabel: string
  notices: StringKey[]
  canUseDemo: boolean
  onSelect: (id: string) => void
  onRetry: () => void
  onUseDemo: () => void
  onReplan: (k: ReplanKind) => void
  onShare: () => Promise<boolean>
  onEmptyAction: (a: 'longer' | 'origin' | 'rephrase') => void
  onEditSearch: () => void
}

const ERROR_KEYS: Record<ApiError['kind'], StringKey> = {
  network: 'errorNetwork',
  timeout: 'errorTimeout',
  validation: 'errorValidation',
  unavailable: 'errorUnavailable',
  server: 'errorServer',
  bad_response: 'errorBadResponse',
}

function Skeleton() {
  return (
    <div className="space-y-3" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <div key={i} className="animate-pulse rounded-2xl border border-slate-200 bg-white p-4">
          <div className="h-3 w-20 rounded bg-slate-200" />
          <div className="mt-2 h-5 w-2/3 rounded bg-slate-200" />
          <div className="mt-3 flex gap-2">
            <div className="h-5 w-24 rounded-full bg-slate-100" />
            <div className="h-5 w-20 rounded-full bg-slate-100" />
          </div>
          <div className="mt-3 h-3 w-full rounded bg-slate-100" />
          <div className="mt-1.5 h-3 w-5/6 rounded bg-slate-100" />
        </div>
      ))}
    </div>
  )
}

export function ResultsPanel(props: Props) {
  const { t, formatDate } = useI18n()
  const { status, response, error, selectedId, notices } = props
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
        <p className="font-semibold">{t(ERROR_KEYS[error.kind], { url: props.apiBaseUrl })}</p>
        {error.details && error.details.length > 0 && (
          <ul className="mt-2 list-disc pl-5 text-xs">
            {error.details.map((d) => (
              <li key={d}>{d}</li>
            ))}
          </ul>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          {error.kind !== 'validation' && (
            <button type="button" className="btn-secondary" onClick={props.onRetry}>
              {t('retry')}
            </button>
          )}
          {props.canUseDemo && error.kind !== 'validation' && (
            <button type="button" className="btn-secondary" onClick={props.onUseDemo} data-testid="use-demo">
              {t('useDemo')}
            </button>
          )}
        </div>
      </div>
    )
  }

  if (!response) return null
  const recs = response.recommendations
  const ordered = response.route?.ordered_poi_ids.length
    ? [
        ...response.route.ordered_poi_ids.map((id) => recs.find((r) => r.id === id)).filter((r) => r !== undefined),
        ...recs.filter((r) => !response.route?.ordered_poi_ids.includes(r.id)),
      ]
    : recs

  return (
    <div className="space-y-3" aria-live="polite">
      {notices.map((n) => (
        <p key={n} className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950" data-testid={`notice-${n}`}>
          {t(n)}
        </p>
      ))}

      {response.warnings.length > 0 && (
        <details className="group rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700" data-testid="warnings">
          <summary className="flex cursor-pointer list-none items-start gap-2">
            <span aria-hidden="true" className="mt-0.5 grid size-4 shrink-0 place-items-center rounded-full bg-slate-200 text-[10px] font-bold text-slate-700">
              i
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-xs font-semibold tracking-wide text-slate-500 uppercase">
                {t('warningsTitle')} · {response.warnings.length}
              </span>
              <span className="block group-open:hidden">{response.warnings[0]}</span>
            </span>
            <span aria-hidden="true" className="text-slate-400 transition-transform group-open:rotate-180">
              ▾
            </span>
          </summary>
          <ul className="mt-1 list-disc space-y-1 pl-9">
            {response.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </details>
      )}

      {recs.length === 0 ? (
        <div data-testid="empty-state" className="rounded-2xl border border-slate-200 bg-white p-5">
          <p className="font-display text-base font-bold text-slate-900">{t('emptyTitle')}</p>
          <p className="mt-1 text-sm text-slate-600">{t('emptyHint')}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className="chip" onClick={() => props.onEmptyAction('longer')}>
              {t('emptyLonger')}
            </button>
            <button type="button" className="chip" onClick={() => props.onEmptyAction('origin')}>
              {t('emptyOtherOrigin')}
            </button>
            <button type="button" className="chip" onClick={() => props.onEmptyAction('rephrase')}>
              {t('emptyRephrase')}
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="flex items-end justify-between gap-3">
            <div>
              <h2 className="font-display text-xl font-extrabold tracking-tight text-slate-900">{t('resultsTitle')}</h2>
              <p className="text-xs text-slate-500">{t('resultsCount', { n: recs.length })}</p>
            </div>
            <button type="button" onClick={props.onEditSearch} className="shrink-0 rounded-lg px-2 py-1 text-sm font-semibold text-sky-800 hover:bg-sky-50">
              ↑ {t('editSearch')}
            </button>
          </div>

          {ordered.length > 1 && (
            <Itinerary stops={ordered} route={response.route} budgetMinutes={props.budgetMinutes} originLabel={props.originLabel} onSelect={props.onSelect} />
          )}

          <ol className="space-y-3">
            {ordered.map((r, i) => (
              <li key={r.id}>
                <ResultCard rec={r} index={i} selected={r.id === selectedId} onSelect={() => props.onSelect(r.id)} />
              </li>
            ))}
          </ol>

          <section aria-labelledby="replan-title" className="rounded-2xl border border-slate-200 bg-white p-4">
            <h3 id="replan-title" className="text-sm font-semibold text-slate-900">
              {t('replanTitle')}
            </h3>
            <div className="mt-2 flex flex-wrap gap-2">
              <button type="button" className="chip" onClick={() => props.onReplan('nature')} data-testid="replan-nature">
                {t('replanNature')}
              </button>
              <button type="button" className="chip" onClick={() => props.onReplan('shorter')} data-testid="replan-shorter">
                {t('replanShorter')}
              </button>
              <button type="button" className="chip" onClick={() => props.onReplan('indoors')} data-testid="replan-indoors">
                {t('replanIndoors')}
              </button>
            </div>
            <button
              type="button"
              className="btn-secondary mt-3 w-full"
              onClick={async () => {
                if (await props.onShare()) {
                  setCopied(true)
                  setTimeout(() => setCopied(false), 2000)
                }
              }}
            >
              {copied ? t('copied') : t('share')}
            </button>
            <p className="mt-1 text-xs text-slate-500">{t('shareNote')}</p>
          </section>
        </>
      )}

      <details className="group rounded-2xl border border-slate-200 bg-white p-4 text-sm" data-testid="evidence">
        <summary className="cursor-pointer font-semibold text-slate-900">{t('evidenceTitle')}</summary>
        <p className="mt-2 text-slate-700">{t('evidenceBody')}</p>
        {response.retrieval_debug != null && (
          <>
            <p className="mt-3 text-xs font-semibold text-slate-500 uppercase">{t('retrievalDebug')}</p>
            <pre className="mt-1 max-h-48 overflow-auto rounded-lg bg-slate-900 p-3 text-[11px] text-slate-100">
              {typeof response.retrieval_debug === 'string' ? response.retrieval_debug : JSON.stringify(response.retrieval_debug, null, 2)}
            </pre>
          </>
        )}
      </details>

      {response.data_updated_at && <p className="text-xs text-slate-500">{t('dataUpdated', { d: formatDate(response.data_updated_at) })}</p>}
    </div>
  )
}
