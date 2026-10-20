import { load } from '@2gis/mapgl'
import { useEffect, useRef, useState } from 'react'
import type { Language, Place, RouteOption } from '../api/types'
import { useI18n } from '../i18n/I18nContext'
import { ASTANA_CENTER, type LatLon } from '../lib/geo'

type MapGL = Awaited<ReturnType<typeof load>>
type MapInstance = InstanceType<MapGL['Map']>
interface Destroyable {
  destroy(): void
}

interface Props {
  /** Browser key for 2GIS MapGL (public, domain-restricted). Null = map not configured. */
  mapKey: string | null
  lang: Language
  origin: LatLon | null
  options: RouteOption[]
  /** Places shown without routes when routing is unavailable. */
  places: Place[]
  selectedId: string | null
  onMapClick: (p: LatLon) => void
  onSelect: (optionId: string) => void
  /** Pixels hidden by the mobile bottom sheet; kept free when fitting a route into view. */
  bottomInset: number
  /** The 2GIS copyright must stay visible: on mobile the bottom edge is under the sheet. */
  copyrightTop: boolean
}

// The official loader caches only after the script has loaded, so overlapping calls (React
// StrictMode, quick remounts) would insert the 2GIS script twice. Share one promise instead.
let mapglPromise: Promise<MapGL> | null = null
function loadMapgl(): Promise<MapGL> {
  mapglPromise ??= load().catch((err: unknown) => {
    mapglPromise = null
    throw err
  })
  return mapglPromise
}

const SELECTED = '#0b5f86'
const OTHER = '#64748b'

function el(className: string, label: string, text = '', onClick?: () => void): HTMLElement {
  const node = document.createElement(onClick ? 'button' : 'div')
  node.className = className
  node.setAttribute('aria-label', label)
  node.title = label
  if (onClick) {
    ;(node as HTMLButtonElement).type = 'button'
    node.addEventListener('click', (e) => {
      e.stopPropagation()
      onClick()
    })
  } else {
    node.setAttribute('role', 'img')
  }
  if (text) node.textContent = text
  return node
}

export function MapView({ mapKey, lang, origin, options, places, selectedId, onMapClick, onSelect, bottomInset, copyrightTop }: Props) {
  const { t } = useI18n()
  const container = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<{ api: MapGL; map: MapInstance } | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading')
  const handlers = useRef({ onMapClick, onSelect })
  useEffect(() => {
    handlers.current = { onMapClick, onSelect }
  }, [onMapClick, onSelect])

  // Create the map once per key. MapGL is loaded from 2GIS's CDN by the official loader.
  useEffect(() => {
    if (!mapKey || !container.current) return
    let cancelled = false
    let map: MapInstance | null = null
    setState('loading')
    loadMapgl()
      .then((api) => {
        if (cancelled || !container.current) return
        map = new api.Map(container.current, {
          center: [ASTANA_CENTER.lon, ASTANA_CENTER.lat],
          zoom: 13,
          key: mapKey,
          lang,
          zoomControl: 'topRight',
          copyright: copyrightTop ? 'topLeft' : 'bottomLeft',
        })
        map.on('click', (e) => handlers.current.onMapClick({ lat: e.lngLat[1], lon: e.lngLat[0] }))
        mapRef.current = { api, map }
        setState('ready')
      })
      .catch(() => !cancelled && setState('failed'))
    return () => {
      cancelled = true
      map?.destroy()
      mapRef.current = null
    }
    // Language changes are applied below; the copyright corner is fixed per map instance.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [mapKey, copyrightTop])

  useEffect(() => {
    if (state === 'ready') mapRef.current?.map.setLanguage(lang)
  }, [lang, state])

  // Keep the canvas in sync with layout changes (bottom sheet, rotation, desktop/mobile switch).
  useEffect(() => {
    const node = container.current
    if (!node || state !== 'ready') return
    const observer = new ResizeObserver(() => mapRef.current?.map.invalidateSize())
    observer.observe(node)
    return () => observer.disconnect()
  }, [state])

  // Draw routes and markers. Every option's line is shown; the selected one is highlighted.
  useEffect(() => {
    const ctx = mapRef.current
    if (state !== 'ready' || !ctx) return
    const { api, map } = ctx
    const objects: Destroyable[] = []
    for (const option of options) {
      const selected = option.id === selectedId
      const line = new api.Polyline(map, {
        coordinates: option.geometry.coordinates,
        width: selected ? 7 : 4,
        color: selected ? SELECTED : OTHER,
        width2: selected ? 11 : 6,
        color2: '#ffffff',
        zIndex: selected ? 30 : 10,
      })
      if (!selected) line.on('click', () => handlers.current.onSelect(option.id))
      objects.push(line)
      option.stops.forEach((stop, i) => {
        const label = t('stopMarker', { n: i + 1, name: stop.name })
        objects.push(
          new api.HtmlMarker(map, {
            coordinates: [stop.lon, stop.lat],
            html: selected
              ? el('qg-stop qg-stop--selected', label, String(i + 1))
              : el('qg-stop-dot', label, '', () => handlers.current.onSelect(option.id)),
            anchor: selected ? [18, 44] : [8, 8],
            zIndex: selected ? 40 : 20,
            interactive: !selected,
          }),
        )
      })
    }
    places.forEach((place, i) => {
      objects.push(
        new api.HtmlMarker(map, {
          coordinates: [place.lon, place.lat],
          html: el('qg-stop', t('stopMarker', { n: i + 1, name: place.name }), String(i + 1)),
          anchor: [18, 44],
          zIndex: 40,
        }),
      )
    })
    if (origin) {
      objects.push(
        new api.HtmlMarker(map, { coordinates: [origin.lon, origin.lat], html: el('qg-origin', t('originMarker'), ''), anchor: [14, 14], zIndex: 50 }),
      )
    }
    return () => objects.forEach((o) => o.destroy())
  }, [state, options, places, selectedId, origin, t])

  // Fit the selected route (or unrouted places) and the origin into the visible part of the map.
  const selected = options.find((o) => o.id === selectedId)
  useEffect(() => {
    const ctx = mapRef.current
    const shown: [number, number][] = selected ? selected.geometry.coordinates : places.map((p) => [p.lon, p.lat])
    if (state !== 'ready' || !ctx || !shown.length) return
    const points = [...shown, ...(origin ? [[origin.lon, origin.lat] as [number, number]] : [])]
    const lons = points.map((p) => p[0])
    const lats = points.map((p) => p[1])
    ctx.map.fitBounds(
      { southWest: [Math.min(...lons), Math.min(...lats)], northEast: [Math.max(...lons), Math.max(...lats)] },
      { padding: { top: 70, left: 40, right: 60, bottom: 40 + bottomInset }, maxZoom: 17 },
    )
    // Re-fit when the selection changes, not on every sheet resize.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [state, selected, places])

  // Without results, keep a newly chosen origin in view.
  useEffect(() => {
    const ctx = mapRef.current
    if (state === 'ready' && ctx && origin && !options.length) ctx.map.setCenter([origin.lon, origin.lat])
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [state, origin])

  return (
    <div className="relative h-full w-full bg-slate-200">
      <div ref={container} className="h-full w-full" role="application" aria-label={t('mapLabel')} data-testid="map" data-map-state={mapKey ? state : 'nokey'} />
      {(!mapKey || state === 'failed') && (
        <div className="absolute inset-x-3 top-14 z-10 rounded-xl bg-white/95 p-3 text-sm text-slate-800 shadow ring-1 ring-slate-200 md:top-3" role="status" data-testid="map-unavailable">
          {mapKey ? t('mapLoadFailed') : t('mapNoKey')}
        </div>
      )}
    </div>
  )
}
