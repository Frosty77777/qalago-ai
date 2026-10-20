import type { RouteOption, Stop } from '../api/types'
import { useI18n } from '../i18n/I18nContext'
import { formatDistance } from '../lib/geo'
import { CategoryIcon } from './CategoryIcon'
import { TransportIcon } from './TransportIcon'

interface Props {
  option: RouteOption
  index: number
  selected: boolean
  onSelect: () => void
}

function HoursBadge({ stop }: { stop: Stop }) {
  const { t } = useI18n()
  if (stop.hours_status === 'open')
    return (
      <span className="badge bg-emerald-50 text-emerald-900 ring-emerald-200" title={t('hoursSource')}>
        {stop.closes_at ? t('hours_open', { t: stop.closes_at }) : t('hours_open_nt')}
      </span>
    )
  if (stop.hours_status === 'closes_soon')
    return (
      <span className="badge bg-amber-50 text-amber-900 ring-amber-300" title={t('hoursSource')}>
        {t('hours_closes_soon', { t: stop.closes_at ?? '' })}
      </span>
    )
  return <span className="badge bg-slate-100 text-slate-700 ring-slate-300">{t('hours_unknown')}</span>
}

export function RouteCard({ option, index, selected, onSelect }: Props) {
  const { t, category, locale } = useI18n()
  const titleId = `route-${option.id}-title`

  return (
    <article
      data-testid="route-card"
      data-route-id={option.id}
      aria-labelledby={titleId}
      aria-current={selected ? 'true' : undefined}
      className={`rounded-2xl border bg-white p-4 shadow-sm transition-colors ${selected ? 'border-sky-700 ring-2 ring-sky-700/30' : 'border-slate-200'}`}
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className={`grid size-8 shrink-0 place-items-center rounded-full text-sm font-bold ${selected ? 'bg-slate-900 text-amber-300' : 'bg-sky-800 text-white'}`}
        >
          {index + 1}
        </span>
        <div className="min-w-0 flex-1">
          <h3 id={titleId} className="font-display text-base leading-snug font-bold break-words text-slate-900">
            {option.title}
          </h3>
          {option.badges.length > 0 && (
            <p className="mt-1 flex flex-wrap gap-1.5 text-xs">
              {option.badges.map((b) => (
                <span key={b} className="badge bg-sky-50 text-sky-900 ring-sky-200">
                  {t(`badge_${b}`)}
                </span>
              ))}
            </p>
          )}
        </div>
      </div>

      <dl className="mt-3 grid grid-cols-[auto_1fr] items-center gap-x-2 gap-y-1 text-sm">
        <dt className="text-slate-500">
          <TransportIcon transport={option.transport} />
          <span className="sr-only">{t(`transport_${option.transport}`)}</span>
        </dt>
        <dd className="font-semibold text-slate-900" data-testid="travel">
          {t('travelValue', { n: option.travel_minutes, d: formatDistance(option.travel_distance_m, locale) })}
          <span className="ml-1 font-normal text-slate-500">· {t(`transport_${option.transport}`)}</span>
        </dd>
        <dt aria-hidden="true" className="text-center text-slate-400">
          ⏱
        </dt>
        <dd className="text-xs text-slate-600">
          {t('visitsEstimate', { n: option.visit_minutes })} · {t('totalOuting', { n: option.total_minutes })}
        </dd>
      </dl>

      <ol className="mt-3 space-y-2" aria-label={t('stopsLabel')}>
        {option.stops.map((stop, i) => (
          <li key={stop.id} className="rounded-xl bg-slate-50 p-2.5 text-sm">
            <p className="flex items-start gap-2">
              <span aria-hidden="true" className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-sky-800 text-[11px] font-bold text-white">
                {i + 1}
              </span>
              <span className="min-w-0">
                <span className="block font-semibold break-words text-slate-900">{stop.name}</span>
                <span className="flex items-center gap-1 text-xs text-slate-600">
                  <CategoryIcon category={stop.category} className="size-3.5 shrink-0" />
                  {stop.rubric ?? category(stop.category)}
                  {stop.address && <span className="truncate">· {stop.address}</span>}
                </span>
              </span>
            </p>
            <p className="mt-1.5 flex flex-wrap gap-1.5 text-xs">
              <HoursBadge stop={stop} />
              <span className="badge bg-white text-slate-800 ring-slate-200">
                {stop.rating != null ? t('rating', { r: stop.rating.toFixed(1), c: stop.review_count }) : t('noRating')}
              </span>
              {stop.average_check != null && <span className="badge bg-white text-slate-800 ring-slate-200">{t('avgCheck', { n: stop.average_check })}</span>}
              {option.stops.length > 1 && (
                <span className="badge bg-white text-slate-800 ring-slate-200">
                  {t('travelValue', { n: stop.travel_minutes, d: formatDistance(stop.travel_distance_m, locale) })}
                </span>
              )}
            </p>
            <a className="mt-1.5 inline-block text-xs font-medium text-sky-800 underline underline-offset-2" href={stop.source_url} target="_blank" rel="noreferrer">
              {t('openIn2gis')}&nbsp;↗
            </a>
          </li>
        ))}
      </ol>

      <details className="mt-3 text-sm" open={selected}>
        <summary className="cursor-pointer font-semibold text-slate-800">{t('whyTitle')}</summary>
        <ul className="mt-1.5 list-disc space-y-1 pl-5 text-slate-700" data-testid="explanation">
          {option.explanation.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </details>

      <button type="button" onClick={onSelect} className="btn-secondary mt-3 w-full" aria-pressed={selected} data-testid="select-route">
        {selected ? `✓ ${t('selectedRoute')}` : t('selectRoute')}
      </button>
    </article>
  )
}
