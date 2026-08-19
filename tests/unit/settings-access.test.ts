import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockRequireBusinessRole, mockRedirect, AuthError, ForbiddenError } = vi.hoisted(() => ({
  mockRequireBusinessRole: vi.fn(),
  mockRedirect: vi.fn((url: string) => { throw new Error(`REDIRECT:${url}`) }),
  AuthError: class AuthError extends Error {},
  ForbiddenError: class ForbiddenError extends Error {},
}))

vi.mock('next/navigation', () => ({ redirect: mockRedirect }))
vi.mock('@/lib/auth/server', () => ({
  AuthError,
  ForbiddenError,
  requireBusinessRole: mockRequireBusinessRole,
}))

import { requireSettingsPageAccess } from '@/lib/business/settings-access'

describe('requireSettingsPageAccess', () => {
  beforeEach(() => vi.clearAllMocks())

  it('redirects unauthenticated users to login', async () => {
    mockRequireBusinessRole.mockRejectedValue(new AuthError())
    await expect(requireSettingsPageAccess()).rejects.toThrow('REDIRECT:/login')
  })

  it('redirects staff to dashboard', async () => {
    mockRequireBusinessRole.mockRejectedValue(new ForbiddenError())
    await expect(requireSettingsPageAccess()).rejects.toThrow('REDIRECT:/dashboard')
  })

  it('propagates unknown errors unchanged', async () => {
    const error = new Error('database unavailable')
    mockRequireBusinessRole.mockRejectedValue(error)
    await expect(requireSettingsPageAccess()).rejects.toBe(error)
  })
})
