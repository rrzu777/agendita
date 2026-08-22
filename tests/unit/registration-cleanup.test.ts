import { describe, expect, it, vi } from 'vitest'
import { runIndependentRegistrationCleanup } from '../e2e/helpers/registration-cleanup'

describe('real registration cleanup', () => {
  it('attempts Auth and PostgreSQL independently and aggregates failures', async () => {
    const auth = vi.fn().mockRejectedValue(new Error('auth unavailable'))
    const database = vi.fn().mockRejectedValue(new Error('database unavailable'))

    await expect(runIndependentRegistrationCleanup({ auth, database })).rejects.toThrow(
      'Registration cleanup failed in 2 steps',
    )
    expect(auth).toHaveBeenCalledOnce()
    expect(database).toHaveBeenCalledOnce()
  })
})
