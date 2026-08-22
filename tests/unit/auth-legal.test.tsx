import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

const mockCreateClient = vi.hoisted(() => vi.fn())
const mockCreateBusinessForUser = vi.hoisted(() => vi.fn())
const mockRedirect = vi.hoisted(() => vi.fn())

vi.mock('@/lib/auth/middleware', () => ({
  createClient: mockCreateClient,
}))

vi.mock('@/lib/business/create-for-user', () => ({
  createBusinessForUser: mockCreateBusinessForUser,
  parseBusinessCategory: vi.fn(() => 'other'),
}))

vi.mock('@/lib/db', () => ({
  prisma: {},
}))

// `unstable_rethrow` lo usa el wrapper `action()`: acá es no-op porque ningún
// error de estos tests es control-flow de Next.
vi.mock('next/navigation', () => ({
  redirect: mockRedirect,
  unstable_rethrow: vi.fn(),
}))

describe('registration legal acceptance', () => {
  it('signUp returns the legal-acceptance error instead of throwing it', async () => {
    vi.resetModules()
    const { signUp } = await import('@/lib/auth/actions')
    const formData = new FormData()
    formData.set('email', 'owner@test.com')
    formData.set('password', 'secret123')
    formData.set('name', 'Owner')

    // El mensaje viaja en el resultado (sobrevive a la redacción de prod), no
    // como throw: RegistrationError extiende UserError.
    const res = await signUp(formData)
    expect(res.ok).toBe(false)
    expect(res.ok === false && res.error).toContain('términos y condiciones')
  })

  it('register page shows terms, privacy and refund links', async () => {
    const { default: RegisterPage } = await import('@/app/register/page')
    const html = renderToStaticMarkup(<RegisterPage />)

    expect(html).toContain('href="/terms"')
    expect(html).toContain('href="/privacy"')
    expect(html).toContain('href="/refund-policy"')
  })

  it('returns the confirmation outcome instead of redirecting without a Supabase session', async () => {
    vi.resetModules()
    mockRedirect.mockClear()
    mockCreateBusinessForUser.mockResolvedValue(undefined)
    mockCreateClient.mockResolvedValue({
      auth: {
        signUp: vi.fn().mockResolvedValue({
          data: { user: { id: 'auth-user-1' }, session: null },
          error: null,
        }),
      },
    })
    const { signUp } = await import('@/lib/auth/actions')
    const formData = new FormData()
    formData.set('email', 'owner@test.com')
    formData.set('password', 'secret123')
    formData.set('name', 'Owner')
    formData.set('acceptedTerms', 'true')

    const res = await signUp(formData)

    expect(res).toEqual({ ok: true, data: { requiresEmailConfirmation: true } })
    expect(mockRedirect).not.toHaveBeenCalled()
    expect(mockCreateBusinessForUser).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'auth-user-1',
      email: 'owner@test.com',
    }))
  })
})
