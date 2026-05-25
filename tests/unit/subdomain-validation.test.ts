import { describe, it, expect } from 'vitest'
import { validateSubdomain, generateDefaultSubdomain } from '@/lib/business/subdomain'

describe('validateSubdomain', () => {
  it('accepts valid subdomain', () => {
    expect(validateSubdomain('mimosnails')).toEqual({ valid: true, sanitized: 'mimosnails' })
  })

  it('accepts subdomain with hyphens', () => {
    expect(validateSubdomain('mimos-nails')).toEqual({ valid: true, sanitized: 'mimos-nails' })
  })

  it('rejects empty string', () => {
    expect(validateSubdomain('').valid).toBe(false)
  })

  it('rejects subdomain too short', () => {
    expect(validateSubdomain('ab').valid).toBe(false)
    expect(validateSubdomain('ab').error).toContain('al menos')
  })

  it('rejects subdomain too long', () => {
    const long = 'a'.repeat(31)
    expect(validateSubdomain(long).valid).toBe(false)
    expect(validateSubdomain(long).error).toContain('máximo')
  })

  it('rejects subdomain starting with hyphen', () => {
    expect(validateSubdomain('-test').valid).toBe(false)
  })

  it('rejects subdomain ending with hyphen', () => {
    expect(validateSubdomain('test-').valid).toBe(false)
  })

  it('rejects subdomain with special characters', () => {
    expect(validateSubdomain('test@domain').valid).toBe(false)
    expect(validateSubdomain('test domain').valid).toBe(false)
    expect(validateSubdomain('test_domain').valid).toBe(false)
  })

  it('normalizes to lowercase', () => {
    const result = validateSubdomain('MimosNails')
    expect(result.valid).toBe(true)
    expect(result.sanitized).toBe('mimosnails')
  })

  it('trims whitespace', () => {
    const result = validateSubdomain('  mimosnails  ')
    expect(result.valid).toBe(true)
    expect(result.sanitized).toBe('mimosnails')
  })

  it('rejects blocked subdomains', () => {
    const blocked = ['www', 'app', 'admin', 'api', 'login', 'dashboard', 'agendita']
    for (const subdomain of blocked) {
      expect(validateSubdomain(subdomain).valid).toBe(false)
    }
  })
})

describe('generateDefaultSubdomain', () => {
  it('generates from email prefix', () => {
    const result = generateDefaultSubdomain('camila@gmail.com')
    expect(result).toMatch(/^[a-z0-9]/)
    expect(result).not.toContain('@')
  })

  it('replaces special characters with hyphens', () => {
    const result = generateDefaultSubdomain('cami.la.morales@gmail.com')
    expect(result).toMatch(/^cami-la-morales/)
  })

  it('does not generate blocked subdomains', () => {
    const result = generateDefaultSubdomain('admin@test.com')
    expect(result).not.toBe('admin')
  })
})
