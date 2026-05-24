/**
 * instrumentation.ts — runs once when the Next.js server container starts.
 * Used for fail-fast validation of critical environment variables.
 *
 * In serverless (Vercel): runs when the container/instance initializes, before
 * the first request is handled. Not called on every invocation.
 *
 * In development: runs once at `next dev` startup.
 */

import { assertValidEnv } from '@/lib/env'

export async function register() {
  // Only validate in Node.js runtime (not Edge), and only in production.
  // Skip validation in test/development to avoid coupling tests to env setup.
  if (process.env.NEXT_RUNTIME === 'nodejs' && process.env.NODE_ENV === 'production') {
    assertValidEnv()
  }
}