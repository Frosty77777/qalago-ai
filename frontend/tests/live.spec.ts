import { expect, test } from '@playwright/test'

// Runs against the REAL backend (start it first; Vite proxies /api to it) and real 2GIS.
// Skipped unless LIVE=1:  npm run test:live
// Each run uses 2GIS Places and Routing quota, so it is never part of the default suite.
test.skip(!process.env.LIVE, 'set LIVE=1 with the backend running and TWOGIS_API_KEY configured')

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('qalago.lang', 'ru'))
})

test('"Хочу кофе" from EXPO returns real 2GIS places and, quota permitting, routes', async ({ page }) => {
  await page.goto('/')
  const sheet = page.getByTestId('bottom-sheet')
  if (await sheet.isVisible()) await page.locator('#query').focus()
  await page.getByTestId('origin-expo').click()
  await page.locator('#query').fill('Хочу кофе')
  await page.getByTestId('search-submit').click()

  const routes = page.getByTestId('route-card')
  const places = page.getByTestId('place-card')
  await expect(routes.first().or(places.first())).toBeVisible({ timeout: 45_000 })
  // Every destination links to its 2GIS card: nothing is invented locally.
  for (const href of await page.locator('a[href*="2gis.kz"]').evaluateAll((els) => els.map((e) => e.getAttribute('href'))))
    expect(href).toMatch(/^https:\/\/2gis\.kz\/astana\/(firm|geo)\/\d+$/)

  if ((await routes.count()) === 0) {
    // Routing quota exhausted or routing down: places must still be real and clearly unrouted.
    await expect(page.getByTestId('routing-unavailable')).toBeVisible()
    return
  }
  expect(await routes.count()).toBeLessThanOrEqual(3)
  await expect(routes.first().getByTestId('travel')).toContainText('мин')
  const first = await routes.evaluateAll((els) => els.map((e) => e.getAttribute('data-route-id')))
  await page.getByTestId('another-route').click()
  await expect(page.getByTestId('another-route')).toBeEnabled({ timeout: 45_000 })
  if (await page.getByTestId('exhausted').isVisible()) return
  const second = await routes.evaluateAll((els) => els.map((e) => e.getAttribute('data-route-id')))
  expect(second.filter((id) => first.includes(id))).toEqual([])
})
