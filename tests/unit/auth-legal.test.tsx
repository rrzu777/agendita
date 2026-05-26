import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('@/lib/auth/middleware', () => ({
  createClient: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  prisma: {},
}))

vi.mock('next/navigation', () => ({
  redirect: vi.fn(),
}))

describe('registration legal acceptance', () => {
  it('signUp rejects when acceptedTerms is missing', async () => {
    vi.resetModules()
    const { RegistrationError } = await import('@/lib/auth/registration-error')
    const { signUp } = await import('@/lib/auth/actions')
    const formData = new FormData()
    formData.set('email', 'owner@test.com')
    formData.set('password', 'secret123')
    formData.set('name', 'Owner')

    await expect(signUp(formData)).rejects.toThrow(RegistrationError)
  })

  it('register page shows terms, privacy and refund links', async () => {
    const { default: RegisterPage } = await import('@/app/register/page')
    const html = renderToStaticMarkup(<RegisterPage />)

    expect(html).toContain('href="/terms"')
    expect(html).toContain('href="/privacy"')
    expect(html).toContain('href="/refund-policy"')
  })
})
