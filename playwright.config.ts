import { defineConfig, devices } from '@playwright/test'

const E2E_AUTH_SECRET = process.env.PLAYWRIGHT_E2E_AUTH_SECRET || 'e2e-secret-local'

const webServerCommand = process.env.CI
  ? 'npm run start'
  : 'npx next dev'

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: 'html',
  timeout: 60000,
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
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
    timeout: 60000,
    env: {
      ...process.env,
      ENABLE_E2E_AUTH_BYPASS: 'true',
      E2E_AUTH_BYPASS_SECRET: E2E_AUTH_SECRET,
      NEXT_PUBLIC_E2E_AUTH_BYPASS_SECRET: E2E_AUTH_SECRET,
    },
  },
})
