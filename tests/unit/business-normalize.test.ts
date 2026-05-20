import { describe, it, expect } from 'vitest'
import { normalizeWhatsapp, normalizeInstagram } from '@/lib/business/normalize'

describe('normalizeWhatsapp', () => {
  it('returns null for empty input', () => {
    expect(normalizeWhatsapp(null)).toBeNull()
    expect(normalizeWhatsapp('')).toBeNull()
    expect(normalizeWhatsapp('   ')).toBeNull()
  })

  it('keeps + prefix if present', () => {
    expect(normalizeWhatsapp('+56912345678')).toBe('+56912345678')
  })

  it('adds +56 prefix for 9-digit Chile mobile', () => {
    expect(normalizeWhatsapp('912345678')).toBe('+56912345678')
    expect(normalizeWhatsapp('9 1234 5678')).toBe('+56912345678')
  })

  it('adds +56 prefix for 8-digit Chile landline', () => {
    expect(normalizeWhatsapp('21234567')).toBe('+5621234567')
    expect(normalizeWhatsapp('2 1234 567')).toBe('+5621234567')
  })

  it('cleans spaces, dashes, dots, parentheses', () => {
    expect(normalizeWhatsapp('+56 9 1234 5678')).toBe('+56912345678')
    expect(normalizeWhatsapp('56-9-1234-5678')).toBe('+56912345678')
    expect(normalizeWhatsapp('(56) 9.1234.5678')).toBe('+56912345678')
  })

  it('returns cleaned number for unknown patterns', () => {
    expect(normalizeWhatsapp('12345')).toBe('12345')
  })
})

describe('normalizeInstagram', () => {
  it('returns null for empty input', () => {
    expect(normalizeInstagram(null)).toBeNull()
    expect(normalizeInstagram('')).toBeNull()
    expect(normalizeInstagram('   ')).toBeNull()
  })

  it('removes @ prefix', () => {
    expect(normalizeInstagram('@miestudio')).toBe('miestudio')
  })

  it('extracts username from full instagram URL', () => {
    expect(normalizeInstagram('https://instagram.com/miestudio')).toBe('miestudio')
    expect(normalizeInstagram('http://instagram.com/miestudio')).toBe('miestudio')
    expect(normalizeInstagram('instagram.com/miestudio')).toBe('miestudio')
    expect(normalizeInstagram('https://www.instagram.com/miestudio/')).toBe('miestudio')
  })

  it('keeps plain username as-is', () => {
    expect(normalizeInstagram('miestudio')).toBe('miestudio')
  })

  it('removes spaces', () => {
    expect(normalizeInstagram('mi estudio')).toBe('miestudio')
  })
})
