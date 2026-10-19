import type { Recommendation } from '../api/types'
import { useI18n } from '../i18n/I18nContext'
import { formatDistance } from '../lib/geo'

interface Props {
  rec: Recommendation
  index: number
  selected: boolean
  onSelect: () => void
}

function AvailabilityBadge({ rec }: { rec: Recommendation }) {
  const { t } = useI18n()
  // Only an explicit backend verification can produce an "open"/"closed" badge.
  if (rec.availability_status === 'verified_open')
    return <span className="badge bg-emerald-100 text-emerald-900 ring-emerald-300">{t('verifiedOpen')}</span>
  if (rec.availability_status === 'verified_closed')
    return <span className="badge bg-rose-100 text-rose-900 ring-rose-300">{t('verifiedClosed')}</span>
  return <span className="badge bg-slate-100 text-slate-700 ring-slate-300">{t('hoursUnknown')}</span>
}

export function ResultCard({ rec, index, selected, onSelect }: Props) {
  const { t, category, locale } = useI18n()
  const facts = rec.facts?.filter(Boolean) ?? []

  return (
    <article
      data-testid="result-card"
      data-poi-id={rec.id}
      aria-current={selected ? 'true' : undefined}
      onClick={(e) => {
        if (!(e.target as HTMLElement).closest('a, button')) onSelect()
      }}
      className={`rounded-2xl border bg-white p-4 shadow-sm transition-colors ${selected ? 'border-sky-700 ring-2 ring-sky-700/30' : 'border-slate-200 hover:border-slate-300'}`}
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className={`mt-0.5 grid size-8 shrink-0 place-items-center rounded-full text-sm font-bold ${selected ? 'bg-slate-900 text-amber-300' : 'bg-sky-800 text-white'}`}
        >
          {index + 1}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-sky-800">{category(rec.category)}</p>
          <h3 className="font-display text-lg leading-snug font-bold text-slate-900">{rec.name}</h3>
          <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
            <span className="badge bg-sky-50 text-sky-900 ring-sky-200" title={t('approxDistanceNote')}>
              {t('straightLine', { d: formatDistance(rec.distance_m, locale) })}
            </span>
            <span className="badge bg-amber-50 text-amber-900 ring-amber-200">{t('visitMinutes', { n: rec.visit_minutes })}</span>
            <AvailabilityBadge rec={rec} />
          </div>
        </div>
      </div>

      <dl className="mt-3 space-y-2 text-sm">
        <div>
          <dt className="font-semibold text-slate-900">{t('reasonLabel')}</dt>
          <dd className="text-slate-700">{rec.reason}</dd>
        </div>
        <div>
          <dt className="font-semibold text-slate-900">{t('activityLabel')}</dt>
          <dd className="text-slate-700">{rec.activity}</dd>
        </div>
      </dl>
      <p className="mt-1 text-xs text-slate-500 italic">{t('generatedNote')}</p>

      <div className="mt-3 rounded-xl bg-slate-50 p-3 text-xs text-slate-700">
        <p className="font-semibold text-slate-900">{t('factsLabel')}</p>
        {facts.length > 0 && (
          <ul className="mt-1 flex flex-wrap gap-1">
            {facts.map((f) => (
              <li key={f} className="rounded bg-white px-1.5 py-0.5 font-mono text-[11px] ring-1 ring-slate-200">
                {f}
              </li>
            ))}
          </ul>
        )}
        {rec.opening_hours && <p className="mt-1">{t('osmHours', { h: rec.opening_hours })}</p>}
        <p className="mt-1">
          {rec.walk_minutes != null && rec.walk_time_source
            ? t('walkTime', { n: rec.walk_minutes, s: rec.walk_time_source })
            : t('walkUnknown')}
        </p>
        <p className="mt-1">
          {rec.source_url ? (
            <a className="font-medium text-sky-800 underline underline-offset-2 hover:text-sky-950" href={rec.source_url} target="_blank" rel="noreferrer">
              {t('sourceLink', { s: rec.source })} ↗
            </a>
          ) : (
            t('sourceLink', { s: rec.source })
          )}
        </p>
      </div>

      <button type="button" onClick={onSelect} className="btn-secondary mt-3 w-full" aria-pressed={selected}>
        {t('showOnMap')}
      </button>
    </article>
  )
}
