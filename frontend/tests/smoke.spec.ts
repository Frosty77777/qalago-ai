import { expect, test, type Page } from '@playwright/test'
import { FIRST, paging, plan, SECOND, SELECTED_COLOR, stub } from './stubs'

// Deterministic UI tests: API, 2GIS MapGL and Google sign-in are stubbed (see stubs.ts).

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('qalago.lang', 'ru'))
})

async function openPanel(page: Page) {
  const sheet = page.getByTestId('bottom-sheet')
  if (await sheet.isVisible()) {
    if ((await sheet.getAttribute('data-state')) !== 'full') await page.getByTestId('sheet-handle').click()
    if ((await sheet.getAttribute('data-state')) !== 'full') await page.getByTestId('sheet-handle').click()
  }
}

async function searchCoffee(page: Page) {
  await page.goto('/')
  await openPanel(page)
  await page.getByTestId('origin-expo').click()
  await page.locator('#query').fill('Хочу кофе')
  await page.getByTestId('search-submit').click()
  await expect(page.getByTestId('route-card')).toHaveCount(3)
}

const mapState = (page: Page) =>
  page.evaluate(() => {
    const m = (window as unknown as { __map?: { polylines: { o: { color: string; coordinates: number[][] } }[]; fits: number; resizes: number; copyright: string } }).__map
    if (!m) return { lines: [], fits: 0, resizes: 0, copyright: null }
    return { lines: m.polylines.map((p) => p.o), fits: m.fits, resizes: m.resizes, copyright: m.copyright }
  })

test('"Хочу кофе" shows ranked route cards and keeps map selection in sync', async ({ page }) => {
  const rec = await stub(page)
  await searchCoffee(page)
  expect(rec.plan[0]).toMatchObject({ query: 'Хочу кофе', language: 'ru', transport: 'walking', max_minutes: 60 })
  expect(rec.plan[0].seen).toBeUndefined()

  const cards = page.getByTestId('route-card')
  await expect(cards.first()).toHaveAttribute('aria-current', 'true')
  await expect(cards.first()).toContainText('Test Coffee One')
  await expect(cards.first().getByTestId('travel')).toContainText('6 мин')
  await expect(cards.first()).toContainText('Открыто до 22:00')
  await expect(cards.first()).toContainText('≈20 мин на месте (оценка)')

  await expect.poll(async () => (await mapState(page)).lines.length).toBe(3)
  const highlighted = () => mapState(page).then((s) => s.lines.filter((l) => l.color === SELECTED_COLOR).map((l) => l.coordinates))
  await expect.poll(highlighted).toEqual([FIRST[0].geometry.coordinates])

  await cards.nth(1).getByTestId('select-route').click()
  await expect(cards.nth(1)).toHaveAttribute('aria-current', 'true')
  await expect(cards.first()).not.toHaveAttribute('aria-current', 'true')
  await expect.poll(highlighted).toEqual([FIRST[1].geometry.coordinates])
  expect((await mapState(page)).fits).toBeGreaterThanOrEqual(2)

  // Selecting another route's stop marker on the map selects its card.
  await page.getByRole('button', { name: 'Остановка 1: Test Coffee Three' }).click()
  await expect(cards.nth(2)).toHaveAttribute('aria-current', 'true')
  await expect.poll(highlighted).toEqual([FIRST[2].geometry.coordinates])
})

test('"Другой маршрут" sends history, shows unseen routes, then explains exhaustion', async ({ page }) => {
  const rec = await stub(page, { plan: paging(400) })
  await searchCoffee(page)
  await page.getByTestId('route-card').nth(1).getByTestId('select-route').click()

  const another = page.getByTestId('another-route')
  await expect(another).toHaveText(/Другой маршрут/)
  await another.click()
  await expect(another).toBeDisabled()
  await another.click({ force: true }) // A second click while loading must not send a request.
  await expect(page.getByTestId('route-card')).toHaveCount(2)
  expect(rec.plan).toHaveLength(2)
  expect(rec.plan[1].seen).toEqual(FIRST.map((o) => o.id))
  expect(rec.plan[1].exclude).toEqual([FIRST[1].id])
  await expect(page.getByTestId('route-card').first()).toContainText('Test Coffee Four')
  await expect(page.getByTestId('route-card').first()).toHaveAttribute('aria-current', 'true')

  await page.getByTestId('another-route').click()
  await expect(page.getByTestId('exhausted')).toContainText('Других маршрутов по этому запросу нет')
  expect(rec.plan[2].seen).toEqual([...FIRST, ...SECOND].map((o) => o.id))
  // Current routes stay visible; useful next steps are offered.
  await expect(page.getByTestId('route-card')).toHaveCount(2)
  await expect(page.getByTestId('suggestion-expand_radius')).toBeVisible()
})

test('changing the request resets the route history', async ({ page }) => {
  const rec = await stub(page, { plan: paging() })
  await searchCoffee(page)
  await page.getByTestId('another-route').click()
  await expect(page.getByTestId('route-card').first()).toContainText('Test Coffee Four')
  await openPanel(page)
  await page.getByTestId('transport-bicycle').click()
  await page.getByTestId('search-submit').click()
  await expect(page.getByTestId('route-card').first()).toContainText('Test Coffee One')
  await page.getByTestId('another-route').click()
  await expect(page.getByTestId('route-card').first()).toContainText('Test Coffee Four')
  expect(rec.plan.at(-1)).toMatchObject({ transport: 'bicycle', seen: FIRST.map((o) => o.id) })
})

test('ambiguous request asks a short question and uses the answer', async ({ page }) => {
  const rec = await stub(page, {
    plan: (body) =>
      body.categories
        ? { json: plan(FIRST) }
        : { json: plan([], { status: 'clarify', question: 'Что вам хочется?', choices: ['coffee', 'park'], interpretation: null }) },
  })
  await page.goto('/')
  await openPanel(page)
  await page.getByTestId('origin-expo').click()
  await page.locator('#query').fill('Куда сходить?')
  await page.getByTestId('search-submit').click()
  await expect(page.getByTestId('clarify')).toContainText('Что вам хочется?')
  await page.getByTestId('choice-coffee').click()
  await expect(page.getByTestId('route-card')).toHaveCount(3)
  expect(rec.plan[1].categories).toEqual(['coffee'])
})

test('provider failures are explained, never replaced with invented routes', async ({ page }) => {
  await stub(page, { plan: () => ({ status: 502, json: { error: { kind: 'key_rejected', service: 'places' } } }) })
  await page.goto('/')
  await openPanel(page)
  await page.getByTestId('origin-expo').click()
  await page.locator('#query').fill('Хочу кофе')
  await page.getByTestId('search-submit').click()
  await expect(page.getByTestId('error-state')).toContainText('2GIS отклонил серверный ключ для сервиса «поиск мест»')
  await expect(page.getByTestId('route-card')).toHaveCount(0)
})

test('routing outage shows the real places found without routes', async ({ page }) => {
  const places = FIRST.map((o) => ({ ...o.stops[0], hours_status: 'open', straight_distance_m: 650 }))
  await stub(page, {
    plan: () => ({ json: plan([], { status: 'routing_unavailable', places, routing_error: { kind: 'rate_limited', service: 'routing' } }) }),
  })
  await page.goto('/')
  await openPanel(page)
  await page.getByTestId('origin-expo').click()
  await page.locator('#query').fill('Хочу кофе')
  await page.getByTestId('search-submit').click()
  await expect(page.getByTestId('routing-unavailable')).toContainText('исчерпан лимит запросов маршрутов 2GIS')
  await expect(page.getByTestId('place-card')).toHaveCount(3)
  await expect(page.getByTestId('place-card').first()).toContainText('650 м по прямой')
  await expect(page.getByTestId('another-route')).toHaveCount(0)
})

test('denied location falls back to manual origin and address search', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'geolocation', {
      value: { getCurrentPosition: (_ok: unknown, fail: (e: object) => void) => fail({ code: 1, PERMISSION_DENIED: 1 }) },
    })
  })
  const rec = await stub(page)
  await page.goto('/')
  await openPanel(page)
  await page.getByRole('button', { name: 'Моё местоположение' }).click()
  await expect(page.getByTestId('geo-denied')).toBeVisible()
  await page.getByLabel('Найти адрес или место старта').fill('Test avenue 55')
  await page.getByRole('button', { name: 'Найти', exact: true }).click()
  await page.getByTestId('origin-results').getByRole('button').first().click()
  await expect(page.getByTestId('origin-status')).toContainText('Test avenue 55')
  await page.locator('#query').fill('Хочу кофе')
  await page.getByTestId('search-submit').click()
  await expect(page.getByTestId('route-card')).toHaveCount(3)
  expect(rec.plan[0]).toMatchObject({ lat: 51.087, lon: 71.418 })
})

test('Google sign-in creates a session, restores it and signs out', async ({ page }) => {
  const rec = await stub(page)
  await page.goto('/')
  await page.getByTestId('gsi-button').click()
  await expect(page.getByTestId('account-button')).toBeVisible()
  expect(rec.auth).toEqual([{ credential: 'header.payload.signature-from-test' }])
  expect(await page.evaluate(() => (window as unknown as { __gsiPrompted?: boolean }).__gsiPrompted)).toBe(true)

  await page.reload()
  await expect(page.getByTestId('account-button')).toBeVisible()
  await page.getByTestId('account-button').click()
  await page.getByTestId('sign-out').click()
  await expect(page.getByTestId('gsi-button')).toBeVisible()
  expect(rec.logout).toBe(1)
})

test('without a 2GIS map key the map explains itself and search still works', async ({ page }) => {
  await stub(page, { config: { twogis_map_key: null, google_client_id: null, places_enabled: true } })
  await page.goto('/')
  await expect(page.getByTestId('map-unavailable')).toContainText('TWOGIS_MAP_KEY')
  await expect(page.getByTestId('sign-in')).toHaveCount(0)
  await openPanel(page)
  await page.getByTestId('origin-expo').click()
  await page.locator('#query').fill('Хочу кофе')
  await page.getByTestId('search-submit').click()
  await expect(page.getByTestId('route-card')).toHaveCount(3)
})

test('mobile layout: no overflow, usable sheet, touch targets, map resizes', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'mobile only')
  await stub(page, { plan: paging() })
  await page.goto('/')
  const sheet = page.getByTestId('bottom-sheet')
  await expect(sheet).toHaveAttribute('data-state', 'half')
  await expect.poll(async () => (await mapState(page)).copyright, { timeout: 15_000 }).toBe('topLeft')

  await page.locator('#query').focus()
  await expect(sheet).toHaveAttribute('data-state', 'full')
  await page.getByTestId('origin-expo').click()
  await page.locator('#query').fill('Хочу кофе')
  await page.getByTestId('search-submit').click()
  await expect(page.getByTestId('route-card')).toHaveCount(3)

  for (const id of ['search-submit', 'another-route', 'sheet-handle', 'transport-walking']) {
    const box = await page.getByTestId(id).first().boundingBox()
    expect(box!.height, id).toBeGreaterThanOrEqual(40)
  }
  const resizesBefore = (await mapState(page)).resizes
  await page.getByTestId('route-card').nth(1).getByTestId('select-route').click()
  await expect(sheet).toHaveAttribute('data-state', 'peek')
  await expect(page.getByTestId('sheet-handle')).toContainText('Test Coffee Two')
  await expect.poll(async () => (await mapState(page)).resizes).toBeGreaterThanOrEqual(resizesBefore)

  await page.getByTestId('sheet-handle').click()
  await page.getByTestId('another-route').click()
  await expect(page.getByTestId('route-card').first()).toContainText('Test Coffee Four')

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBe(0)
})

test('tapping the map sets the origin and names it', async ({ page }) => {
  await stub(page)
  await page.goto('/')
  const map = page.getByTestId('map')
  const box = (await map.boundingBox())!
  await page.mouse.click(box.x + box.width - 30, box.y + 120)
  await openPanel(page)
  await expect(page.getByTestId('origin-status')).toContainText('Test street 99')
})
