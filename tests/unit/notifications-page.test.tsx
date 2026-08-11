import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  hasUsablePushConfig: vi.fn(),
}))

vi.mock('@/lib/auth/user', () => ({ getCurrentUser: mocks.getCurrentUser }))
vi.mock('@/lib/push/config', () => ({ hasUsablePushConfig: mocks.hasUsablePushConfig }))
vi.mock('@/components/push/push-manager', () => ({
  PushManager: ({ isAuthenticated, vapidPublicKey }: { isAuthenticated: boolean; vapidPublicKey: string | null }) => (
    <span>{isAuthenticated ? 'authenticated-manager' : 'guest-manager'}:{vapidPublicKey ?? 'push-disabled'}</span>
  ),
}))

import NotificationsPage from '@/app/notificaciones/page'

describe('/notificaciones', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('NEXT_PUBLIC_VAPID_PUBLIC_KEY', 'public-key-present')
    mocks.hasUsablePushConfig.mockReturnValue(true)
  })

  afterEach(() => vi.unstubAllEnvs())

  it.each([
    { user: { id: 'user-1' }, expected: 'authenticated-manager' },
    { user: null, expected: 'guest-manager' },
  ])('passes server-derived authentication state to PushManager', async ({ user, expected }) => {
    mocks.getCurrentUser.mockResolvedValue(user)

    const html = renderToStaticMarkup(await NotificationsPage())

    expect(html).toContain(expected)
  })

  it('passes the public key only when the complete runtime push configuration is usable', async () => {
    mocks.getCurrentUser.mockResolvedValue(null)

    const enabled = renderToStaticMarkup(await NotificationsPage())
    mocks.hasUsablePushConfig.mockReturnValue(false)
    const disabled = renderToStaticMarkup(await NotificationsPage())

    expect(enabled).toContain('guest-manager:public-key-present')
    expect(disabled).toContain('guest-manager:push-disabled')
    expect(disabled).not.toContain('public-key-present')
  })
})
