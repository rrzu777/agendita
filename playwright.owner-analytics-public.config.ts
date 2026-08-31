import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e', testMatch: 'owner-analytics-public.spec.ts', fullyParallel: false,
  forbidOnly: true, workers: 1, timeout: 60_000, expect: { timeout: 15_000 }, reporter: [['list']],
  outputDir: 'test-results/owner-analytics-public',
  use: {
    baseURL: 'http://localhost:3555', headless: true, timezoneId: 'America/Santiago',
    // Network traces would persist signed fixture credentials; screenshots are sufficient here.
    screenshot: 'only-on-failure', trace: 'off',
    // Explicit synthetic ordinary-browser UA: production intentionally rejects HeadlessChrome.
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'node tests/config/run-owner-analytics-public-server.mjs', url: 'http://127.0.0.1:3555',
    reuseExistingServer: false, timeout: 120_000, stdout: 'pipe', stderr: 'pipe',
    gracefulShutdown: { signal: 'SIGTERM', timeout: 10_000 },
  },
})
