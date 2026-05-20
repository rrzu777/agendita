import { describe, it, expect } from 'vitest'
import { updateBusinessSchema } from '@/lib/business/schema'

describe('updateBusinessSchema', () => {
  it('accepts valid data', () => {
    const result = updateBusinessSchema.safeParse({
      name: 'Mi Estudio',
      city: 'Santiago',
      subdomain: 'miestudio',
      timezone: 'America/Santiago',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.name).toBe('Mi Estudio')
      expect(result.data.subdomain).toBe('miestudio')
    }
  })

  it('rejects empty name', () => {
    const result = updateBusinessSchema.safeParse({ name: '', city: 'Santiago', subdomain: 'test' })
    expect(result.success).toBe(false)
  })

  it('rejects name > 100 chars', () => {
    const result = updateBusinessSchema.safeParse({ name: 'a'.repeat(101), city: 'Santiago', subdomain: 'test' })
    expect(result.success).toBe(false)
  })

  it('transforms subdomain to lowercase', () => {
    const result = updateBusinessSchema.safeParse({ name: 'Test', city: 'Santiago', subdomain: 'MiEstudio' })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.subdomain).toBe('miestudio')
    }
  })

  it('rejects subdomain with spaces', () => {
    const result = updateBusinessSchema.safeParse({ name: 'Test', city: 'Santiago', subdomain: 'mi estudio' })
    expect(result.success).toBe(false)
  })

  it('rejects subdomain < 3 chars', () => {
    const result = updateBusinessSchema.safeParse({ name: 'Test', city: 'Santiago', subdomain: 'ab' })
    expect(result.success).toBe(false)
  })

  it('rejects invalid URL', () => {
    const result = updateBusinessSchema.safeParse({
      name: 'Test', city: 'Santiago', subdomain: 'test',
      profileImageUrl: 'not-a-url',
    })
    expect(result.success).toBe(false)
  })

  it('allows empty URL', () => {
    const result = updateBusinessSchema.safeParse({
      name: 'Test', city: 'Santiago', subdomain: 'test',
      profileImageUrl: '',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.profileImageUrl).toBe('')
    }
  })

  it('rejects empty city', () => {
    const result = updateBusinessSchema.safeParse({ name: 'Test', city: '', subdomain: 'test' })
    expect(result.success).toBe(false)
  })

  it('rejects bio > 500 chars', () => {
    const result = updateBusinessSchema.safeParse({
      name: 'Test', city: 'Santiago', subdomain: 'test',
      bio: 'a'.repeat(501),
    })
    expect(result.success).toBe(false)
  })

  it('accepts whatsapp with spaces', () => {
    const result = updateBusinessSchema.safeParse({
      name: 'Test', city: 'Santiago', subdomain: 'test',
      whatsapp: '9 1234 5678',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.whatsapp).toBe('9 1234 5678')
    }
  })

  it('accepts instagram with @', () => {
    const result = updateBusinessSchema.safeParse({
      name: 'Test', city: 'Santiago', subdomain: 'test',
      instagram: '@miestudio',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.instagram).toBe('@miestudio')
    }
  })
})
