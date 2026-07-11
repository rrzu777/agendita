import { describe, it, expect } from 'vitest'
import { updateBusinessSchema, slotStepToMinutes } from '@/lib/business/schema'

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

  it('rejects name with only spaces', () => {
    const result = updateBusinessSchema.safeParse({ name: '   ', city: 'Santiago', subdomain: 'test' })
    expect(result.success).toBe(false)
  })

  it('rejects city with only spaces', () => {
    const result = updateBusinessSchema.safeParse({ name: 'Test', city: '   ', subdomain: 'test' })
    expect(result.success).toBe(false)
  })

  it('defaults slotStepMinutes to "30" when not provided', () => {
    const result = updateBusinessSchema.safeParse({
      name: 'Test', city: 'Santiago', subdomain: 'test',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.slotStepMinutes).toBe('30')
    }
  })

  it('converts form values to minutes for the DB (null = service duration)', () => {
    expect(slotStepToMinutes('service')).toBeNull()
    expect(slotStepToMinutes('15')).toBe(15)
    expect(slotStepToMinutes('30')).toBe(30)
  })

  it('rejects steps outside the allowed set', () => {
    const result = updateBusinessSchema.safeParse({
      name: 'Test', city: 'Santiago', subdomain: 'test',
      slotStepMinutes: '20',
    })
    expect(result.success).toBe(false)
  })

  it('defaults timezone when not provided', () => {
    const result = updateBusinessSchema.safeParse({
      name: 'Test', city: 'Santiago', subdomain: 'test',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.timezone).toBe('America/Santiago')
    }
  })

  it('selfServiceCutoffHours: default 24, rango 0-720, entero', () => {
    const minimalValid = { name: 'Test', city: 'Santiago', subdomain: 'test' }
    expect(updateBusinessSchema.parse({ ...minimalValid }).selfServiceCutoffHours).toBe(24)
    expect(updateBusinessSchema.parse({ ...minimalValid, selfServiceCutoffHours: 0 }).selfServiceCutoffHours).toBe(0)
    expect(() => updateBusinessSchema.parse({ ...minimalValid, selfServiceCutoffHours: 721 })).toThrow()
    expect(() => updateBusinessSchema.parse({ ...minimalValid, selfServiceCutoffHours: -1 })).toThrow()
    // Input vacío del form ('') debe volver al default 24, no convertirse en 0 (= sin límite).
    expect(updateBusinessSchema.parse({ ...minimalValid, selfServiceCutoffHours: '' }).selfServiceCutoffHours).toBe(24)
  })
})
