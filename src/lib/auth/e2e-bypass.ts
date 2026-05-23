import { headers } from 'next/headers'

/**
 * Shared E2E auth bypass logic — usable in server components and server actions.
 * 
 * Security gates:
 *   1. ENABLE_E2E_AUTH_BYPASS must be "true"
 *   2. In dev/test: bypass enabled automatically
 *   3. In production: requires APP_ENV="e2e" + E2E_AUTH_BYPASS_SECRET set
 *   4. The x-e2e-auth-secret header must match E2E_AUTH_BYPASS_SECRET (when set)
 * 
 * In production builds, process.env is inlined at build time, so:
 *   - Build normally: bypass is dead code (ENABLE_E2E_AUTH_BYPASS inlined as undefined)
 *   - Build with env vars: bypass activates for matching requests
 */

export function isE2EBypassEnabled(): boolean {
  if (process.env.ENABLE_E2E_AUTH_BYPASS !== 'true') return false

  const isDevOrTest = process.env.NODE_ENV !== 'production'
  if (isDevOrTest) return true

  // Production gate: must explicitly opt in with APP_ENV=e2e + secret
  return process.env.APP_ENV === 'e2e' && !!process.env.E2E_AUTH_BYPASS_SECRET
}

export function getE2EBypassSecret(): string | null {
  if (!isE2EBypassEnabled()) return null

  // In dev/test without explicit secret, no secret validation needed
  if (process.env.NODE_ENV !== 'production' && !process.env.E2E_AUTH_BYPASS_SECRET) {
    return null // null means "any secret accepted"
  }

  return process.env.E2E_AUTH_BYPASS_SECRET || null
}

export async function validateE2EHeaders(): Promise<string | null> {
  if (!isE2EBypassEnabled()) return null

  const headersList = await headers()
  const email = headersList.get('x-e2e-test-user-email')
  if (!email) return null

  const secret = headersList.get('x-e2e-auth-secret')
  if (!secret) return null

  const expectedSecret = getE2EBypassSecret()
  if (expectedSecret !== null && secret !== expectedSecret) return null

  return email
}
