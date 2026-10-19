import type { Recommendation, Route } from '../api/types'
import { useI18n } from '../i18n/I18nContext'
import { formatDistance } from '../lib/geo'

interface Props {
  stops: Recommendation[]
  route: Route | null
  budgetMinutes: number
  originLabel: string
  onSelect: (id: string) => void
}

export function Itinerary({ stops, route, budgetMinutes, originLabel, onSelect }: Props) {
  const { t, locale } = useI18n()
  const visitTotal = stops.reduce((sum, s) => sum + s.visit_minutes, 0)
  const approximate = !route || route.is_approximate || !route.geometry

  return (
    <section aria-labelledby="itinerary-title" data-testid="itinerary" className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex items-baseline justify-between gap-2">
        <h3 id="itinerary-title" className="font-display text-base font-bold text-slate-900">
          {t('itineraryTitle')}
        </h3>
        <p className="text-xs font-medium text-slate-600">{t('itineraryVisits', { n: visitTotal, m: budgetMinutes })}</p>
      </div>

      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100" aria-hidden="true">
        <div className="h-full rounded-full bg-amber-400" style={{ width: `${Math.min(100, (visitTotal / budgetMinutes) * 100)}%` }} />
      </div>

      <ol className="mt-3 space-y-0">
        <li className="flex gap-3 pb-3">
          <span className="relative grid size-6 shrink-0 place-items-center">
            <span className="size-3 rounded-full bg-amber-400 ring-4 ring-amber-100" />
            <span className="absolute top-6 h-[calc(100%-0.5rem)] w-px border-l-2 border-dotted border-slate-300" />
          </span>
          <span className="text-sm text-slate-600">
            <span className="font-semibold text-slate-900">{t('start')}</span> · {originLabel}
          </span>
        </li>
        {stops.map((s, i) => (
          <li key={s.id} className="flex gap-3 pb-3 last:pb-0">
            <span className="relative grid size-6 shrink-0 place-items-center">
              <span className="grid size-6 place-items-center rounded-full bg-sky-800 text-xs font-bold text-white">{i + 1}</span>
              {i < stops.length - 1 && <span className="absolute top-6 h-[calc(100%-0.5rem)] w-px border-l-2 border-dotted border-slate-300" />}
            </span>
            <button type="button" onClick={() => onSelect(s.id)} className="min-w-0 flex-1 rounded-md text-left text-sm hover:bg-slate-50">
              <span className="block font-semibold text-slate-900">{s.name}</span>
              <span className="block text-xs text-slate-600">
                {t('visitMinutes', { n: s.visit_minutes })} · {t('straightLine', { d: formatDistance(s.distance_m, locale) })}
                {s.walk_minutes != null && s.walk_time_source ? ` · ${t('walkTime', { n: s.walk_minutes, s: s.walk_time_source })}` : ''}
              </span>
            </button>
          </li>
        ))}
      </ol>

      <div className="mt-3 space-y-1 rounded-xl bg-sky-50 p-3 text-xs text-sky-950">
        {route?.route_minutes != null && !route.is_approximate && <p>{t('itineraryRouteMinutes', { n: route.route_minutes })}</p>}
        {approximate && <p>{t('itinerarySchematic')}</p>}
        {route?.route_minutes == null && <p>{t('itineraryTravelNotIncluded')}</p>}
      </div>
    </section>
  )
}
