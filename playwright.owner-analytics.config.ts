import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: 'owner-analytics.spec.ts',
  fullyParallel: false,
  forbidOnly: true,
  workers: 1,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  outputDir: 'test-results/owner-analytics',
  use: {
    baseURL: 'http://127.0.0.1:3555',
    headless: true,
    screenshot: 'only-on-failure',
    trace: 'on-first-retry',
    timezoneId: 'America/Santiago',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'node tests/config/run-owner-analytics-e2e-server.mjs',
    url: 'http://127.0.0.1:3555',
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
})
