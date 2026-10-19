import { expect, test, type Page, type Route } from '@playwright/test'
import fixture from '../src/mocks/demoPois.json' with { type: 'json' }

// The backend is stubbed with page.route. Response POIs are taken from the real OSM snapshot
// in src/mocks/demoPois.json, so no invented places appear even in tests.

const API = 'http://localhost:8000'
const TRANSPARENT_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64')
const pois = fixture.pois
const byName = (name: string) => {
  const p = pois.find((x) => x.name === name)
  if (!p) throw new Error(`fixture POI ${name} missing`)
  return p
}

function rec(name: string, extra: Record<string, unknown> = {}) {
  const p = byName(name)
  return {
    id: p.id,
    name: p.name,
    category: p.category,
    lat: p.lat,
    lon: p.lon,
    distance_m: 640,
    reason: `Reason for ${p.name}`,
    visit_minutes: 25,
    activity: `Activity at ${p.name}`,
    opening_hours: p.opening_hours,
    source: 'OpenStreetMap',
    source_url: p.source_url,
    facts: [`${p.category}`],
    walk_minutes: null,
    walk_time_source: null,
    availability_status: 'unknown',
    ...extra,
  }
}

const threeStops = () => {
  const recs = [rec('Президент саябағы'), rec('Starbucks'), rec('Бәйтерек')]
  return {
    recommendations: recs,
    route: { ordered_poi_ids: recs.map((r) => r.id), geometry: null, route_minutes: null, is_approximate: true },
    data_updated_at: '2026-10-19T16:43:20Z',
    warnings: ['Walking time and opening hours were not independently verified'],
    retrieval_debug: { matched_categories: ['park', 'cafe'] },
  }
}

interface Stub {
  recommend?: (body: Record<string, unknown>) => { status?: number; json: unknown } | 'abort'
  down?: boolean
}

async function stubApi(page: Page, stub: Stub = {}) {
  const requests: Record<string, unknown>[] = []
  // Never fetch real OSM tiles from tests (tile usage policy); serve a 1x1 transparent PNG.
  await page.route('https://tile.openstreetmap.org/**', (route) => route.fulfill({ contentType: 'image/png', body: TRANSPARENT_PNG }))
  await page.route(`${API}/api/**`, async (route: Route) => {
    if (stub.down) return route.abort('connectionrefused')
    const url = new URL(route.request().url())
    if (url.pathname === '/api/health')
      return route.fulfill({ json: { status: 'ok', poi_count: pois.length, llm_enabled: true, dataset_updated_at: fixture.collected_at } })
    if (url.pathname === '/api/pois') return route.fulfill({ json: pois })
    if (url.pathname === '/api/recommend') {
      const body = route.request().postDataJSON() as Record<string, unknown>
      requests.push(body)
      const res = stub.recommend ? stub.recommend(body) : { json: threeStops() }
      if (res === 'abort') return route.abort('connectionrefused')
      return route.fulfill({ status: res.status ?? 200, json: res.json })
    }
    return route.fulfill({ status: 404, json: { detail: 'not found' } })
  })
  return requests
}

async function setLang(page: Page, lang: 'en' | 'ru' | 'kk') {
  // Seed only on the first load so reload tests can observe the app's own persistence.
  await page.addInitScript((l) => {
    if (!sessionStorage.getItem('qalago.seeded')) {
      sessionStorage.setItem('qalago.seeded', '1')
      localStorage.setItem('qalago.lang', l)
    }
  }, lang)
}

test.describe('QalaGo AI smoke', () => {
  test('loads map, attribution, health and privacy note', async ({ page }) => {
    await stubApi(page)
    await setLang(page, 'en')
    await page.goto('/')
    await expect(page.locator('.leaflet-container')).toBeVisible()
    await expect(page.locator('.leaflet-control-attribution')).toContainText('OpenStreetMap')
    await expect(page.getByTestId('health-ok')).toContainText(`${pois.length} places`)
    await expect(page.getByTestId('privacy-note')).toBeVisible()
  })

  test('search flow sends contract request and renders sourced cards + itinerary', async ({ page }) => {
    const requests = await stubApi(page)
    await setLang(page, 'en')
    await page.goto('/')
    await page.getByTestId('origin-expo').click()
    await page.getByLabel('What would you like to do?').fill('Walk with a coffee')
    await page.getByTestId('search-submit').click()

    await expect(page.getByTestId('result-card')).toHaveCount(3)
    expect(requests[0]).toMatchObject({ query: 'Walk with a coffee', lat: 51.09279, lon: 71.42148, max_minutes: 60, language: 'en', mode: 'walk' })
    expect(requests[0].preferences).toEqual(expect.arrayContaining(['walk']))

    const first = page.getByTestId('result-card').first()
    await expect(first).toContainText('as the crow flies')
    await expect(first).toContainText('Hours not verified')
    await expect(first.getByRole('link', { name: /Source: OpenStreetMap/ })).toHaveAttribute('href', /openstreetmap\.org\/(node|way|relation)\//)
    await expect(page.getByText(/Open now/)).toHaveCount(0)
    await expect(page.getByTestId('itinerary')).toContainText('They are not walking routes')
    await expect(page.locator('.qg-stop')).toHaveCount(3)
    await expect(page.locator('.qg-origin')).toHaveCount(1)

    // Route selection: card button focuses the POI and highlights its marker.
    await page.getByTestId('result-card').nth(1).getByRole('button', { name: 'Show on map' }).click()
    await expect(page.getByTestId('result-card').nth(1)).toHaveAttribute('aria-current', 'true')
    await expect(page.locator('.qg-stop--selected')).toHaveCount(1)
  })

  test('clicking the map sets a custom origin used in the request', async ({ page }) => {
    const requests = await stubApi(page)
    await setLang(page, 'en')
    await page.goto('/')
    const map = page.locator('.leaflet-container')
    const box = (await map.boundingBox())!
    await page.mouse.click(box.x + box.width / 2 + 40, box.y + box.height / 2 + 30)
    await expect(page.getByTestId('origin-status')).toContainText('Point picked on map')
    await page.getByLabel('What would you like to do?').fill('park')
    await page.getByTestId('search-submit').click()
    await expect(page.getByTestId('result-card')).toHaveCount(3)
    expect(Math.abs((requests[0].lat as number) - 51.128)).toBeLessThan(0.05)
  })

  test('declined geolocation shows guidance and presets still work', async ({ page }) => {
    await stubApi(page)
    await setLang(page, 'en')
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'geolocation', {
        value: { getCurrentPosition: (_ok: unknown, fail: (e: object) => void) => fail({ code: 1, PERMISSION_DENIED: 1, message: 'denied' }) },
      })
    })
    await page.goto('/')
    await page.getByRole('button', { name: /Use my location/ }).click()
    await expect(page.getByText('Location permission was declined')).toBeVisible()
    await page.getByTestId('origin-baiterek').click()
    await expect(page.getByTestId('origin-status')).toContainText('Bayterek area')
  })

  test('empty result shows next steps; "allow more time" re-queries', async ({ page }) => {
    const requests = await stubApi(page, {
      recommend: () => ({ json: { recommendations: [], route: null, data_updated_at: null, warnings: ['No places matched; try a larger radius'], retrieval_debug: null } }),
    })
    await setLang(page, 'en')
    await page.goto('/')
    await page.getByTestId('origin-expo').click()
    await page.getByLabel('What would you like to do?').fill('ice skating rink on the moon')
    await page.getByTestId('search-submit').click()
    await expect(page.getByTestId('empty-state')).toBeVisible()
    await expect(page.getByTestId('warnings')).toContainText('No places matched')
    await page.getByRole('button', { name: 'Allow more time' }).click()
    await expect.poll(() => requests.length).toBe(2)
    expect(requests[1].max_minutes).toBe(120)
  })

  test('unavailable API shows error with retry and explicit demo fallback', async ({ page }) => {
    await stubApi(page, { down: true })
    await setLang(page, 'en')
    await page.goto('/')
    await expect(page.getByTestId('health-down')).toBeVisible()
    await page.getByTestId('origin-expo').click()
    await page.getByLabel('What would you like to do?').fill('coffee')
    await page.getByTestId('search-submit').click()
    await expect(page.getByTestId('error-state')).toContainText('backend is unreachable')
    await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible()
    await expect(page.getByTestId('demo-badge')).toHaveCount(0)

    await page.getByTestId('use-demo').click()
    await expect(page.getByTestId('demo-badge')).toBeVisible()
    await expect(page.getByTestId('result-card').first()).toContainText('[Demo template]')
  })

  test('422 validation details are shown', async ({ page }) => {
    await stubApi(page, { recommend: () => ({ status: 422, json: { detail: [{ loc: ['body', 'max_minutes'], msg: 'Input should be less than or equal to 240' }] } }) })
    await setLang(page, 'en')
    await page.goto('/')
    await page.getByTestId('origin-expo').click()
    await page.getByLabel('What would you like to do?').fill('walk')
    await page.getByTestId('search-submit').click()
    await expect(page.getByTestId('error-state')).toContainText('max_minutes: Input should be less than or equal to 240')
  })

  test('three languages: UI switches, request re-sent in new language, choice persists', async ({ page }) => {
    const requests = await stubApi(page)
    await setLang(page, 'ru')
    await page.goto('/')
    await expect(page.getByTestId('search-submit')).toHaveText('Найти места')
    await page.getByTestId('origin-expo').click()
    await page.getByTestId('scenario-walk60').click()
    await expect(page.getByTestId('result-card')).toHaveCount(3)
    expect(requests[0]).toMatchObject({ language: 'ru', query: 'Хочу прогуляться рядом 30–60 минут' })

    await page.getByTestId('lang-select').selectOption('kk')
    await expect(page.getByTestId('search-submit')).toHaveText('Орындарды табу')
    await expect.poll(() => requests.length).toBe(2)
    expect(requests[1]).toMatchObject({ language: 'kk', query: 'Жақын жерде 30–60 минут серуендегім келеді' })
    await expect(page.locator('html')).toHaveAttribute('lang', 'kk')

    await page.getByTestId('lang-select').selectOption('en')
    await expect(page.getByTestId('search-submit')).toHaveText('Find places')
    await expect.poll(() => requests.length).toBe(3)
    expect(requests[2].language).toBe('en')

    await page.reload()
    await expect(page.getByTestId('search-submit')).toHaveText('Find places')
  })

  test('scenario notices: flight, quiet coffee; family preset changes preferences', async ({ page }) => {
    const requests = await stubApi(page)
    await setLang(page, 'en')
    await page.goto('/')
    await page.getByTestId('origin-baiterek').click()

    await page.getByTestId('scenario-tourist2h').click()
    await expect(page.getByTestId('notice-flightNotice')).toBeVisible()
    expect(requests[0].max_minutes).toBe(120)

    await page.getByTestId('scenario-coffee').click()
    await expect(page.getByTestId('notice-quietNotice')).toBeVisible()

    await page.getByTestId('scenario-family').click()
    await expect.poll(() => requests.length).toBe(3)
    expect(requests[2].preferences).toEqual(expect.arrayContaining(['family', 'playground']))
  })

  test('only verified_open shows an open badge', async ({ page }) => {
    await stubApi(page, {
      recommend: () => {
        const r = threeStops()
        r.recommendations[1] = rec('Starbucks', { availability_status: 'verified_open' })
        return { json: r }
      },
    })
    await setLang(page, 'en')
    await page.goto('/')
    await page.getByTestId('origin-expo').click()
    await page.getByLabel('What would you like to do?').fill('coffee')
    await page.getByTestId('search-submit').click()
    await expect(page.getByText('Open now (verified)')).toHaveCount(1)
    await expect(page.getByText('Hours not verified')).toHaveCount(2)
  })

  test('re-plan buttons send real new queries', async ({ page }) => {
    const requests = await stubApi(page)
    await setLang(page, 'en')
    await page.goto('/')
    await page.getByTestId('origin-expo').click()
    await page.getByLabel('What would you like to do?').fill('walk')
    await page.getByTestId('search-submit').click()
    await expect(page.getByTestId('result-card')).toHaveCount(3)
    await page.getByTestId('replan-indoors').click()
    await expect.poll(() => requests.length).toBe(2)
    expect(requests[1].preferences).toEqual(expect.arrayContaining(['indoors', 'museum']))
    await page.getByTestId('replan-shorter').click()
    await expect.poll(() => requests.length).toBe(3)
    expect(requests[2].max_minutes).toBe(30)
  })

  test('share link never contains coordinates', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await stubApi(page)
    await setLang(page, 'en')
    await page.goto('/')
    await page.getByTestId('origin-expo').click()
    await page.getByLabel('What would you like to do?').fill('walk')
    await page.getByTestId('search-submit').click()
    await page.getByRole('button', { name: 'Copy share link' }).click()
    await expect(page.getByRole('button', { name: 'Link copied' })).toBeVisible()
    const url = await page.evaluate(() => navigator.clipboard.readText())
    expect(url).toContain('origin=expo')
    expect(url).not.toMatch(/51\.\d|71\.\d|lat=|lon=/)
  })
})

test.describe('mobile 375px', () => {
  test.use({ viewport: { width: 375, height: 740 }, isMobile: true, hasTouch: true })

  test('bottom sheet layout, reachable controls, no horizontal scroll', async ({ page }) => {
    await stubApi(page)
    await setLang(page, 'en')
    await page.goto('/')
    await expect(page.getByTestId('bottom-sheet')).toBeVisible()
    await page.getByTestId('origin-expo').tap()
    await page.getByLabel('What would you like to do?').fill('walk')
    await page.getByTestId('search-submit').scrollIntoViewIfNeeded()
    await page.getByTestId('search-submit').tap()
    await expect(page.getByTestId('result-card')).toHaveCount(3)
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    expect(overflow).toBeLessThanOrEqual(0)

    const showOnMap = page.getByTestId('result-card').first().getByRole('button', { name: 'Show on map' })
    await showOnMap.scrollIntoViewIfNeeded()
    await showOnMap.tap()
    await expect(page.getByTestId('bottom-sheet')).toHaveAttribute('data-state', 'peek')
    await expect(page.locator('.qg-stop--selected')).toBeVisible()
  })
})
