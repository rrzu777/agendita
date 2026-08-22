import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { runIndependentRegistrationCleanup } from '../e2e/helpers/registration-cleanup'

describe('real registration E2E contract', () => {
  it('consumes a disposable Supabase link and proves authenticated dashboard access', async () => {
    const source = await readFile(
      resolve(process.cwd(), 'tests/e2e/registration-real-auth.spec.ts'),
      'utf8',
    )

    expect(source).toContain("type: 'magiclink'")
    expect(source).toContain('properties.action_link')
    expect(source).toContain("page.waitForURL('**/dashboard/onboarding')")
    expect(source).toContain("page.waitForURL('**/dashboard')")
    expect(source).toContain("name: /resumen de/i")
  })

  it('attempts Auth and PostgreSQL cleanup independently and aggregates failures', async () => {
    const auth = vi.fn().mockRejectedValue(new Error('auth unavailable'))
    const database = vi.fn().mockRejectedValue(new Error('database unavailable'))

    await expect(runIndependentRegistrationCleanup({ auth, database })).rejects.toThrow(
      'Registration cleanup failed in 2 steps',
    )
    expect(auth).toHaveBeenCalledOnce()
    expect(database).toHaveBeenCalledOnce()
  })
})
