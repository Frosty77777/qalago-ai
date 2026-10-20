import type { Page, Route } from '@playwright/test'

// Test doubles for the three external dependencies: the QalaGo API, 2GIS MapGL and Google
// Identity Services. Place names below are synthetic and exist only in these tests.

export const SELECTED_COLOR = '#0b5f86'

type Json = Record<string, unknown>

export function option(id: string, name: string, minutes: number, extra: Json = {}) {
  const lat = 51.093 + minutes / 10000
  return {
    id,
    title: `Кофе: ${name}`,
    transport: 'walking',
    stops: [
      {
        id: `place-${id}`,
        name,
        lat,
        lon: 71.422,
        category: 'coffee',
        rubric: 'Кофейни',
        address: 'Test street 1',
        rating: 4.7,
        review_count: 120,
        hours_status: 'open',
        closes_at: '22:00',
        average_check: null,
        accessibility: null,
        laptop_friendly: null,
        source_url: `https://2gis.kz/astana/firm/${id}`,
        travel_minutes: minutes,
        travel_distance_m: minutes * 70,
        transit_summary: null,
        visit_minutes: 20,
      },
    ],
    travel_minutes: minutes,
    travel_distance_m: minutes * 70,
    visit_minutes: 20,
    total_minutes: minutes + 20,
    geometry: { type: 'LineString', coordinates: [[71.4215, 51.0928], [71.422, lat]] },
    explanation: [`В пути ${minutes} мин пешком — по маршруту 2GIS.`, 'Подходит под «Кофе»: рубрика 2GIS «Кофейни».'],
    badges: [],
    score: { relevance: 1, travel: 0.8, quality: 0.94, constraints: 1, total: 0.9 },
    ...extra,
  }
}

export function plan(options: Json[], extra: Json = {}) {
  return {
    status: 'ok',
    options,
    places: [],
    routing_error: null,
    interpretation: {
      categories: ['coffee'],
      free_text: null,
      transport: 'walking',
      transport_from_text: false,
      budget_minutes: 60,
      budget_from_text: false,
      open_now: false,
      cheap: false,
      accessible: false,
      quiet: false,
      source: 'rules',
    },
    question: null,
    choices: [],
    notices: ['Поиск в радиусе около 1,7 км от точки старта.'],
    suggestions: ['expand_radius', 'longer_time', 'change_preferences', 'change_transport'],
    ranking_note: 'Порядок вариантов: соответствие запросу 40%, время в пути 30%…',
    radius_m: 1680,
    attribution: '© 2GIS',
    ...extra,
  }
}

export const FIRST = [option('aaaaaaaaaaaaaaa1', 'Test Coffee One', 6), option('aaaaaaaaaaaaaaa2', 'Test Coffee Two', 9), option('aaaaaaaaaaaaaaa3', 'Test Coffee Three', 12)]
export const SECOND = [option('bbbbbbbbbbbbbbb1', 'Test Coffee Four', 14), option('bbbbbbbbbbbbbbb2', 'Test Coffee Five', 17)]

export interface ApiStub {
  plan?: (body: Json, call: number) => { status?: number; json: unknown; delayMs?: number }
  config?: Json
  user?: Json | null
}

export interface Recorded {
  plan: Json[]
  auth: Json[]
  logout: number
}

const FAKE_MAPGL = `
(() => {
  const state = window.__map = { polylines: [], markers: [], fits: 0, resizes: 0, maps: 0, lang: null };
  class Map {
    constructor(container, options) {
      state.maps++; state.lang = options.lang; state.copyright = options.copyright;
      this.container = typeof container === 'string' ? document.getElementById(container) : container;
      this.container.style.position = 'relative';
      this.handlers = {};
      this.container.addEventListener('click', (e) => {
        if (e.target !== this.container) return;
        (this.handlers.click || []).forEach((h) => h({ lngLat: [71.4301, 51.1302] }));
      });
    }
    on(name, h) { (this.handlers[name] = this.handlers[name] || []).push(h); }
    setLanguage(l) { state.lang = l; return this; }
    invalidateSize() { state.resizes++; return this; }
    fitBounds() { state.fits++; return this; }
    setCenter() { return this; }
    destroy() {}
  }
  class Polyline {
    constructor(map, o) { this.o = o; this.handlers = {}; state.polylines.push(this); }
    on(name, h) { this.handlers[name] = h; }
    destroy() { state.polylines = state.polylines.filter((p) => p !== this); }
  }
  class HtmlMarker {
    constructor(map, o) {
      this.o = o; this.el = o.html instanceof HTMLElement ? o.html : Object.assign(document.createElement('div'), { innerHTML: o.html });
      this.el.dataset.testMarker = '1'; this.el.style.position = 'absolute';
      this.el.style.left = (10 + state.markers.length * 30) + 'px'; this.el.style.top = '10px';
      map.container.appendChild(this.el); state.markers.push(this);
    }
    destroy() { this.el.remove(); state.markers = state.markers.filter((m) => m !== this); }
  }
  window.mapgl = { Map, Polyline, HtmlMarker };
})();`

const FAKE_GSI = `
window.google = { accounts: { id: {
  initialize(c) { window.__gsi = c; },
  renderButton(parent) {
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = 'Continue with Google'; b.dataset.testid = 'gsi-button';
    b.onclick = () => window.__gsi.callback({ credential: 'header.payload.signature-from-test' });
    parent.appendChild(b);
  },
  prompt() { window.__gsiPrompted = true; }, cancel() {}, disableAutoSelect() { window.__gsiDisabled = true; },
} } };`

export async function stub(page: Page, s: ApiStub = {}): Promise<Recorded> {
  const rec: Recorded = { plan: [], auth: [], logout: 0 }
  let user = s.user ?? null
  let calls = 0
  await page.route('https://mapgl.2gis.com/**', (r) => r.fulfill({ contentType: 'text/javascript', headers: { 'Access-Control-Allow-Origin': '*' }, body: FAKE_MAPGL }))
  await page.route('https://accounts.google.com/gsi/client', (r) => r.fulfill({ contentType: 'text/javascript', body: FAKE_GSI }))
  // Only the app's own origin: 2GIS also serves its script under /api/.
  await page.route((url) => url.hostname === 'localhost' && url.pathname.startsWith('/api/'), async (route: Route) => {
    const url = new URL(route.request().url())
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
    switch (url.pathname) {
      case '/api/config':
        return json(s.config ?? { twogis_map_key: 'test-map-key', google_client_id: 'test-client.apps.googleusercontent.com', places_enabled: true })
      case '/api/auth/me':
        return json({ user, auth_enabled: true })
      case '/api/auth/google': {
        rec.auth.push(route.request().postDataJSON())
        user = { id: 7, email: 'tester@example.com', name: 'Test User', picture: null }
        return json({ user })
      }
      case '/api/auth/logout':
        rec.logout++
        user = null
        return route.fulfill({ status: 204 })
      case '/api/reverse-geocode':
        return json({ name: 'Test street 99' })
      case '/api/geocode':
        return json([{ name: 'Астана, Test avenue 55', lat: 51.087, lon: 71.418 }])
      case '/api/plan': {
        const body = route.request().postDataJSON() as Json
        rec.plan.push(body)
        const res = s.plan ? s.plan(body, calls++) : { json: plan(FIRST) }
        if (res.delayMs) await new Promise((r) => setTimeout(r, res.delayMs))
        return json(res.json, res.status ?? 200)
      }
    }
    return json({ error: { kind: 'not_found' } }, 404)
  })
  return rec
}

/** Default "another route" behaviour: first page, then two unseen routes, then exhausted. */
export function paging(delayMs = 0) {
  return (body: Json) => {
    const seen = (body.seen as string[] | undefined) ?? []
    if (!seen.length) return { json: plan(FIRST) }
    if (!seen.includes(SECOND[0].id)) return { json: plan(SECOND), delayMs }
    return { json: plan([], { status: 'exhausted' }), delayMs }
  }
}
