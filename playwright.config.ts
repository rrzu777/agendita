import { defineConfig, devices } from '@playwright/test'

const E2E_AUTH_SECRET = process.env.PLAYWRIGHT_E2E_AUTH_SECRET || 'e2e-secret-local'
// Public, test-only VAPID pair. It enables the real push UI in the E2E server;
// Playwright still mocks the browser subscription and intercepts the API call.
const E2E_VAPID_PUBLIC_KEY = 'BAmuMRGniKzfw0ZShPIqYtZrZM8Ilz2YJYG3eS8T9rXcK3BEMp4ckNkh5EywptWzWaDLfHmcfWXKixB0ghV1HPI'
const E2E_VAPID_PRIVATE_KEY = 'TXp4YjNafvXJhv6X-AyT-6kG_8BzlCTFc2bebFORnyA'

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
      // Public pages that detect an optional session still construct the
      // Supabase SSR client. Placeholders keep guest-only E2E self-contained;
      // no auth request is sent when the browser has no session cookie.
      NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://test.supabase.co',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'anon-key-for-tests',
      NEXT_PUBLIC_VAPID_PUBLIC_KEY: E2E_VAPID_PUBLIC_KEY,
      VAPID_PRIVATE_KEY: E2E_VAPID_PRIVATE_KEY,
      VAPID_SUBJECT: 'mailto:e2e@agendita.test',
      ENCRYPTION_KEY: 'e2e-only-push-encryption-key-32-bytes',
      // Suppress external integrations during E2E tests
      RESEND_API_KEY: '',
      FROM_EMAIL: '',
    },
  },
})
