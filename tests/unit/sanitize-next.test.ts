import { describe, expect, it } from 'vitest'

function sanitizeNext(next: string | null): string {
  if (!next) return '/dashboard'
  if (!next.startsWith('/')) return '/dashboard'
  if (next.startsWith('//')) return '/dashboard'
  return next
}

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
