import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

const mockCreateClient = vi.fn()

vi.mock('@/lib/auth/middleware', () => ({
  createClient: mockCreateClient,
}))

vi.mock('@/lib/db', () => ({ prisma: {} }))

vi.mock('next/navigation', () => ({
  redirect: vi.fn(),
}))

describe('login and password recovery', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.NEXT_PUBLIC_APP_DOMAIN = 'agendita.test'
    process.env.APP_DOMAIN = 'agendita.test'
  })

  it('returns a friendly invalid-credentials error instead of throwing sanitized server errors', async () => {
    mockCreateClient.mockResolvedValue({
      auth: {
        signInWithPassword: vi.fn().mockResolvedValue({ error: new Error('Invalid login credentials') }),
      },
    })
    const { signIn } = await import('@/lib/auth/actions')
    const formData = new FormData()
    formData.set('email', 'bad@example.com')
    formData.set('password', 'wrong-password')

    await expect(signIn(formData)).resolves.toEqual({ error: 'Email o contraseña incorrectos' })
  })

  it('login page links to password recovery', async () => {
    const { default: LoginPage } = await import('@/app/login/page')
    const html = renderToStaticMarkup(<LoginPage />)

    expect(html).toContain('href="/forgot-password"')
  })

  it('requestPasswordReset sends a recovery email using configured app domain', async () => {
    const resetPasswordForEmail = vi.fn().mockResolvedValue({ error: null })
    mockCreateClient.mockResolvedValue({ auth: { resetPasswordForEmail } })
    const { requestPasswordReset } = await import('@/lib/auth/actions')
    const formData = new FormData()
    formData.set('email', 'owner@example.com')

    await expect(requestPasswordReset(formData)).resolves.toEqual({ success: true })
    expect(resetPasswordForEmail).toHaveBeenCalledWith('owner@example.com', {
      redirectTo: 'https://agendita.test/auth/callback?next=/reset-password',
    })
  })
})
