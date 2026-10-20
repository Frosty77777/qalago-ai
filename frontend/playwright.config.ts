import { defineConfig, devices } from '@playwright/test'

// Uses the locally installed Google Chrome by default (no browser download needed).
// Set PW_CHANNEL= (empty) to use Playwright's bundled Chromium after `npx playwright install chromium`.
const channel = process.env.PW_CHANNEL ?? 'chrome'

export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  fullyParallel: true,
  workers: process.env.CI ? 2 : 3,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5173',
    channel: channel || undefined,
    trace: 'retain-on-failure',
    // Parallel headless Chrome instances on Windows contend for the GPU and drop to ~1 fps,
    // which stalls Playwright's stability checks. Software rendering keeps them at 60 fps.
    launchOptions: { args: ['--disable-gpu'] },
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], channel: channel || undefined, viewport: { width: 1440, height: 900 } } },
    { name: 'mobile', use: { ...devices['Pixel 7'], channel: channel || undefined } },
    { name: 'small-phone', use: { ...devices['iPhone SE'], browserName: 'chromium', channel: channel || undefined }, grep: /mobile layout/ },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
  },
})
