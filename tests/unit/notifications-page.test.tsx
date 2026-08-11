import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

const mocks = vi.hoisted(() => ({ getCurrentUser: vi.fn() }))

vi.mock('@/lib/auth/user', () => ({ getCurrentUser: mocks.getCurrentUser }))
vi.mock('@/components/push/push-manager', () => ({
  PushManager: ({ isAuthenticated }: { isAuthenticated: boolean }) => (
    <span>{isAuthenticated ? 'authenticated-manager' : 'guest-manager'}</span>
  ),
}))

import NotificationsPage from '@/app/notificaciones/page'

describe('/notificaciones', () => {
  beforeEach(() => vi.clearAllMocks())

  it.each([
    { user: { id: 'user-1' }, expected: 'authenticated-manager' },
    { user: null, expected: 'guest-manager' },
  ])('passes server-derived authentication state to PushManager', async ({ user, expected }) => {
    mocks.getCurrentUser.mockResolvedValue(user)

    const html = renderToStaticMarkup(await NotificationsPage())

    expect(html).toContain(expected)
  })
})
