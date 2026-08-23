import { afterEach, describe, expect, it, vi } from 'vitest'

const originalEnv = { ...process.env }

function setEnv(value: string | undefined) {
  if (value === undefined) {
    delete process.env.DASHBOARD_TOURS_ENABLED
  } else {
    process.env.DASHBOARD_TOURS_ENABLED = value
  }
}

afterEach(() => {
  process.env = { ...originalEnv }
  vi.resetModules()
})

describe('dashboard tours rollout flag', () => {
  it.each([
    [undefined, false],
    ['false', false],
    ['true', true],
  ] as const)('defaults safely and reads %s as %s', async (configured, expected) => {
    setEnv(configured)
    const { getDashboardToursEnabled } = await import('@/lib/env')

    expect(getDashboardToursEnabled()).toBe(expected)
  })

  it.each(['enabled', ''])('rejects malformed value %j during runtime access and environment validation', async (configured) => {
    setEnv(configured)
    const { getDashboardToursEnabled, validateEnv } = await import('@/lib/env')

    expect(() => getDashboardToursEnabled()).toThrow(/DASHBOARD_TOURS_ENABLED/)
    expect(validateEnv().errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'DASHBOARD_TOURS_ENABLED' }),
    ]))
  })
})
