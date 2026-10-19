import L from 'leaflet'
import { useEffect, useMemo } from 'react'
import { CircleMarker, MapContainer, Marker, Polyline, Popup, TileLayer, Tooltip, useMap, useMapEvents } from 'react-leaflet'
import type { Poi, Recommendation, Route } from '../api/types'
import { useI18n } from '../i18n/I18nContext'
import { ASTANA_CENTER, type LatLon } from '../lib/geo'

interface Props {
  origin: LatLon | null
  recommendations: Recommendation[]
  route: Route | null
  selectedId: string | null
  backgroundPois: Poi[]
  onMapClick: (p: LatLon) => void
  onSelect: (id: string) => void
  /** Extra bottom padding (px) when fitting bounds, so a mobile bottom sheet does not hide markers. */
  bottomInset: number
  /** On mobile the bottom sheet covers the map's bottom edge, so attribution moves to the top. */
  attributionTop: boolean
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c)
}

const originIcon = (label: string) =>
  L.divIcon({
    className: '',
    html: `<div class="qg-origin" role="img" aria-label="${escapeHtml(label)}"><span></span></div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  })

const stopIcon = (n: number, selected: boolean, label: string) =>
  L.divIcon({
    className: '',
    html: `<div class="qg-stop${selected ? ' qg-stop--selected' : ''}" role="img" aria-label="${escapeHtml(label)}"><span>${n}</span></div>`,
    iconSize: selected ? [42, 42] : [34, 34],
    // The pin is a square rotated 45°, so its tip sits half a diagonal below the centre.
    iconAnchor: selected ? [21, 51] : [17, 41],
  })

function ClickHandler({ onMapClick }: { onMapClick: (p: LatLon) => void }) {
  useMapEvents({ click: (e) => onMapClick({ lat: e.latlng.lat, lon: e.latlng.lng }) })
  return null
}

function FitToResults({ origin, recommendations, bottomInset }: Pick<Props, 'origin' | 'recommendations' | 'bottomInset'>) {
  const map = useMap()
  useEffect(() => {
    if (!recommendations.length) return
    const points: [number, number][] = recommendations.map((r) => [r.lat, r.lon])
    if (origin) points.push([origin.lat, origin.lon])
    map.flyToBounds(L.latLngBounds(points), { paddingTopLeft: [48, 48], paddingBottomRight: [48, 48 + bottomInset], maxZoom: 16, duration: 0.6 })
    // Re-fit only when the result set changes, not on every inset or origin change.
  }, [recommendations, map]) // oxlint-disable-line react-hooks/exhaustive-deps
  return null
}

function FocusSelected({ selected }: { selected: Recommendation | undefined }) {
  const map = useMap()
  useEffect(() => {
    if (selected) map.flyTo([selected.lat, selected.lon], Math.max(map.getZoom(), 15), { duration: 0.5 })
  }, [selected, map])
  return null
}

function PanToOrigin({ origin }: { origin: LatLon | null }) {
  const map = useMap()
  useEffect(() => {
    if (origin && !map.getBounds().pad(-0.1).contains([origin.lat, origin.lon])) map.panTo([origin.lat, origin.lon])
  }, [origin, map])
  return null
}

export function MapView({ origin, recommendations, route, selectedId, backgroundPois, onMapClick, onSelect, bottomInset, attributionTop }: Props) {
  const { t, category } = useI18n()

  const ordered = useMemo(() => {
    if (!route?.ordered_poi_ids.length) return recommendations
    const byId = new Map(recommendations.map((r) => [r.id, r]))
    const inRoute = route.ordered_poi_ids.map((id) => byId.get(id)).filter((r): r is Recommendation => !!r)
    return [...inRoute, ...recommendations.filter((r) => !route.ordered_poi_ids.includes(r.id))]
  }, [recommendations, route])

  const resultIds = useMemo(() => new Set(recommendations.map((r) => r.id)), [recommendations])

  // A real routed geometry is drawn solid; otherwise only a schematic dashed connection.
  const routedLine: [number, number][] | null =
    route?.geometry && !route.is_approximate ? route.geometry.coordinates.map(([lon, lat]) => [lat, lon]) : null
  const schematicLine: [number, number][] =
    routedLine || !route || route.ordered_poi_ids.length < 2
      ? []
      : [...(origin ? [[origin.lat, origin.lon] as [number, number]] : []), ...ordered.map((r) => [r.lat, r.lon] as [number, number])]

  return (
    <MapContainer
      center={[ASTANA_CENTER.lat, ASTANA_CENTER.lon]}
      zoom={13}
      minZoom={10}
      preferCanvas
      className="h-full w-full"
      aria-label={t('mapLabel')}
      zoomControl={false}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors'
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        maxZoom={19}
      />
      <ZoomControlTopRight />
      <AttributionPosition top={attributionTop} />
      <ClickHandler onMapClick={onMapClick} />
      <PanToOrigin origin={origin} />
      <FitToResults origin={origin} recommendations={recommendations} bottomInset={bottomInset} />
      <FocusSelected selected={recommendations.find((r) => r.id === selectedId)} />

      {backgroundPois
        .filter((p) => !resultIds.has(p.id))
        .map((p) => (
          <CircleMarker
            key={p.id}
            center={[p.lat, p.lon]}
            radius={4}
            pathOptions={{ color: '#ffffff', weight: 1, fillColor: '#64748b', fillOpacity: 0.75 }}
            bubblingMouseEvents={false}
          >
            <Popup>
              <strong>{p.name}</strong>
              <br />
              {category(p.category)}
              <br />
              <a href={p.source_url} target="_blank" rel="noreferrer">
                OpenStreetMap
              </a>
            </Popup>
          </CircleMarker>
        ))}

      {routedLine && <Polyline positions={routedLine} pathOptions={{ color: '#0b5f86', weight: 5, opacity: 0.85 }} attribution="Route &copy; 2GIS" />}
      {schematicLine.length > 1 && (
        <Polyline positions={schematicLine} pathOptions={{ color: '#0b5f86', weight: 3, opacity: 0.8, dashArray: '2 10', lineCap: 'round' }} />
      )}

      {origin && (
        <Marker position={[origin.lat, origin.lon]} icon={originIcon(t('originMarker'))} title={t('originMarker')} alt={t('originMarker')} zIndexOffset={500} keyboard={false} />
      )}

      {ordered.map((r, i) => {
        const selected = r.id === selectedId
        const label = `${t('stop', { n: i + 1 })}: ${r.name}`
        return (
          <Marker
            key={r.id}
            position={[r.lat, r.lon]}
            icon={stopIcon(i + 1, selected, label)}
            title={label}
            alt={label}
            zIndexOffset={selected ? 1000 : 600}
            eventHandlers={{ click: () => onSelect(r.id) }}
          >
            <Tooltip direction="top" offset={[0, selected ? -50 : -40]} opacity={1}>
              {r.name}
            </Tooltip>
          </Marker>
        )
      })}
    </MapContainer>
  )
}

function AttributionPosition({ top }: { top: boolean }) {
  const map = useMap()
  useEffect(() => {
    map.attributionControl?.setPosition(top ? 'topleft' : 'bottomright')
  }, [map, top])
  return null
}

function ZoomControlTopRight() {
  const map = useMap()
  useEffect(() => {
    const ctl = L.control.zoom({ position: 'topright' }).addTo(map)
    return () => {
      ctl.remove()
    }
  }, [map])
  return null
}
