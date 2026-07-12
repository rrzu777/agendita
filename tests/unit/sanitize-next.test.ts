import { describe, expect, it } from 'vitest'
import { authErrorRedirectPath, sanitizeNext } from '@/lib/auth/sanitize-next'

describe('sanitizeNext', () => {
  it('returns /dashboard when null', () => {
    expect(sanitizeNext(null)).toBe('/dashboard')
  })

  it('returns /dashboard when empty string', () => {
    expect(sanitizeNext('')).toBe('/dashboard')
  })

  it('returns the path when valid', () => {
    expect(sanitizeNext('/reset-password')).toBe('/reset-password')
  })

  it('returns /dashboard when protocol-relative URL (//evil.com)', () => {
    expect(sanitizeNext('//evil.com')).toBe('/dashboard')
  })

  it('returns /dashboard when full URL-like (https://evil.com)', () => {
    expect(sanitizeNext('https://evil.com')).toBe('/dashboard')
  })

  it('returns /dashboard when relative without leading slash', () => {
    expect(sanitizeNext('evil.com')).toBe('/dashboard')
  })

  it('returns path with query params intact', () => {
    expect(sanitizeNext('/dashboard?foo=bar')).toBe('/dashboard?foo=bar')
  })
})

describe('authErrorRedirectPath', () => {
  it('trata /paquetes/* como flujo de clienta y vuelve a /ingresar', () => {
    const url = authErrorRedirectPath('/paquetes/demo?comprar=abc', 'oauth')
    expect(url.startsWith('/ingresar')).toBe(true)
    expect(url).toContain('next=')
  })

  it('sin next de clienta sigue yendo a /login (dueñas)', () => {
    expect(authErrorRedirectPath('/dashboard', 'oauth').startsWith('/login')).toBe(true)
  })
})
