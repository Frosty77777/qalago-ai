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
  const routed = !!route && !route.is_approximate
  // Without a backend route these are independent options, not an ordered walk (see FRONTEND_HANDOFF).
  if (!route || (!routed && route.ordered_poi_ids.length < 2)) return <VisitOptions stops={stops} budgetMinutes={budgetMinutes} />

  const walkTotal = routed ? (route.route_minutes ?? stops.reduce((sum, s) => sum + (s.walk_minutes ?? 0), 0)) : 0
  const total = visitTotal + walkTotal
  const scale = Math.max(budgetMinutes, total)

  return (
    <section aria-labelledby="itinerary-title" data-testid="itinerary" className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex items-baseline justify-between gap-2">
        <h3 id="itinerary-title" className="font-display text-base font-bold text-slate-900">
          {routed ? t('routeTitle') : t('itineraryTitle')}
        </h3>
        <p className="text-xs font-medium text-slate-600" data-testid="itinerary-total">
          {routed ? t('itineraryTotal', { n: total, m: budgetMinutes }) : t('itineraryVisits', { n: visitTotal, m: budgetMinutes })}
        </p>
      </div>

      <div className="mt-2 flex h-2 gap-0.5 overflow-hidden rounded-full bg-slate-100" aria-hidden="true">
        {walkTotal > 0 && <div className="bg-sky-700" style={{ width: `${(walkTotal / scale) * 100}%` }} />}
        <div className="bg-amber-400" style={{ width: `${(visitTotal / scale) * 100}%` }} />
      </div>
      {routed && (
        <p className="mt-1.5 flex gap-3 text-[11px] text-slate-600" aria-hidden="true">
          <span className="flex items-center gap-1">
            <span className="size-2 rounded-full bg-sky-700" />
            {t('legendWalk', { n: walkTotal })}
          </span>
          <span className="flex items-center gap-1">
            <span className="size-2 rounded-full bg-amber-400" />
            {t('legendVisit', { n: visitTotal })}
          </span>
        </p>
      )}

      <ol className="mt-3">
        <li className="flex gap-3 pb-2">
          <span className="relative grid w-6 shrink-0 justify-items-center">
            <span className="mt-1 size-3 rounded-full bg-amber-400 ring-4 ring-amber-100" />
            <span className="absolute top-5 bottom-0 border-l-2 border-dotted border-slate-300" />
          </span>
          <span className="text-sm text-slate-600">
            <span className="font-semibold text-slate-900">{t('start')}</span> · {originLabel}
          </span>
        </li>
        {stops.map((s, i) => (
          <li key={s.id}>
            {s.walk_minutes != null && s.walk_time_source && (
              <div className="flex gap-3 pb-2" data-testid="walk-leg">
                <span className="relative grid w-6 shrink-0 justify-items-center">
                  <span className="absolute inset-y-0 border-l-2 border-sky-700" />
                </span>
                <span className="rounded-full bg-sky-50 px-2 py-0.5 text-xs font-medium text-sky-900">🚶 {t('walkLeg', { n: s.walk_minutes })}</span>
              </div>
            )}
            <div className="flex gap-3 pb-2">
              <span className="relative grid w-6 shrink-0 justify-items-center">
                <span className="grid size-6 place-items-center rounded-full bg-sky-800 text-xs font-bold text-white">{i + 1}</span>
                {i < stops.length - 1 && !stops[i + 1].walk_minutes && (
                  <span className="absolute top-6 bottom-0 border-l-2 border-dotted border-slate-300" />
                )}
              </span>
              <button type="button" onClick={() => onSelect(s.id)} className="min-w-0 flex-1 rounded-md text-left text-sm hover:bg-slate-50">
                <span className="block font-semibold text-slate-900">{s.name}</span>
                <span className="block text-xs text-slate-600">
                  {t('visitMinutes', { n: s.visit_minutes })} · {t('straightLine', { d: formatDistance(s.distance_m, locale) })}
                </span>
              </button>
            </div>
          </li>
        ))}
      </ol>

      <div className="mt-2 space-y-1 rounded-xl bg-sky-50 p-3 text-xs text-sky-950">
        {routed ? (
          <>
            <p>{t('routeNote')}</p>
            <p className="font-medium">{t('routeAttribution')}</p>
          </>
        ) : (
          <>
            <p>{t('itinerarySchematic')}</p>
            <p>{t('itineraryTravelNotIncluded')}</p>
          </>
        )}
      </div>
    </section>
  )
}

function VisitOptions({ stops, budgetMinutes }: { stops: Recommendation[]; budgetMinutes: number }) {
  const { t } = useI18n()
  const visitTotal = stops.reduce((sum, s) => sum + s.visit_minutes, 0)
  return (
    <section aria-labelledby="options-title" data-testid="visit-options" className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex items-baseline justify-between gap-2">
        <h3 id="options-title" className="font-display text-base font-bold text-slate-900">
          {t('optionsTitle')}
        </h3>
        <p className="text-xs font-medium text-slate-600">{t('itineraryVisits', { n: visitTotal, m: budgetMinutes })}</p>
      </div>
      <div className="mt-2 flex h-2 gap-0.5 overflow-hidden rounded-full bg-slate-100" aria-hidden="true">
        {stops.map((s, i) => (
          <div key={s.id} className={i % 2 ? 'bg-amber-300' : 'bg-amber-400'} style={{ width: `${(s.visit_minutes / Math.max(budgetMinutes, visitTotal)) * 100}%` }} />
        ))}
      </div>
      <p className="mt-3 text-xs text-slate-600">{t('optionsNote')}</p>
    </section>
  )
}
