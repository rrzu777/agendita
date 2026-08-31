import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const databaseUrl = 'postgresql://analytics:analytics@127.0.0.1:55439/agendita_owner_analytics_test'
const localEnvironmentFiles = ['.env', '.env.local', '.env.development', '.env.development.local']
const foundLocalEnvironmentFile = localEnvironmentFiles.find((name) => existsSync(join(process.cwd(), name)))

if (foundLocalEnvironmentFile) {
  console.error(`Owner analytics E2E requires an isolated worktree without ${foundLocalEnvironmentFile}; use the task worktree instead.`)
  process.exit(1)
}

const child = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev', '--hostname', '127.0.0.1', '--port', '3555'], {
  cwd: process.cwd(),
  stdio: 'inherit',
  env: {
    PATH: process.env.PATH ?? '',
    DATABASE_URL: databaseUrl,
    DIRECT_URL: databaseUrl,
    NEXT_PUBLIC_SUPABASE_URL: 'https://analytics-e2e.invalid',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'analytics-e2e-anon-key',
    APP_DOMAIN: 'analytics.e2e.test',
    NEXT_PUBLIC_APP_DOMAIN: 'analytics.e2e.test',
    PAYMENT_PROVIDER: 'manual',
    OWNER_ANALYTICS_ENABLED: 'false',
    ENABLE_E2E_AUTH_BYPASS: 'true',
    E2E_AUTH_BYPASS_SECRET: 'owner-analytics-e2e-secret',
    RESEND_API_KEY: '',
    FROM_EMAIL: '',
    VAPID_PRIVATE_KEY: '',
    NEXT_PUBLIC_VAPID_PUBLIC_KEY: '',
    ENCRYPTION_KEY: 'owner-analytics-e2e-key-32-bytes',
    NEXT_TELEMETRY_DISABLED: '1',
  },
})

child.on('exit', (code, signal) => process.exitCode = signal ? 1 : (code ?? 1))
