import { defineConfig, devices } from '@playwright/test'

const E2E_AUTH_SECRET = process.env.PLAYWRIGHT_E2E_AUTH_SECRET || 'e2e-secret-local'

const webServerCommand = process.env.CI
  ? 'npm run start'
  : 'npm run dev'

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: [
    ['html', { open: 'never' }],
    ['list'],
  ],
  timeout: 30_000,
  expect: {
    timeout: 10_000,
  },
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
    headless: true,
    screenshot: 'only-on-failure',
    // The seeded business is in America/Santiago. Pin the browser to that zone so
    // client-side date/time construction (e.g. the manual booking form) matches
    // the business timezone regardless of where the runner executes (CI = UTC).
    timezoneId: 'America/Santiago',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: webServerCommand,
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      ...process.env,
      ENABLE_E2E_AUTH_BYPASS: 'true',
      E2E_AUTH_BYPASS_SECRET: E2E_AUTH_SECRET,
      NEXT_PUBLIC_E2E_AUTH_BYPASS_SECRET: E2E_AUTH_SECRET,
      PAYMENT_PROVIDER: 'mock',
      // Suppress external integrations during E2E tests
      RESEND_API_KEY: '',
      FROM_EMAIL: '',
    },
  },
})
