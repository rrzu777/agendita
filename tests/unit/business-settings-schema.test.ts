import { describe, it, expect } from 'vitest'
import * as businessSchemas from '@/lib/business/schema'
import {
  policySettingsSchema,
  profileSettingsSchema,
  reservationSettingsSchema,
  slotStepToMinutes,
} from '@/lib/business/schema'

it('exposes only section-scoped settings schemas', () => {
  expect(businessSchemas).not.toHaveProperty('updateBusinessSchema')
})

describe('section settings schemas', () => {
  it('profile schema owns only public identity fields', () => {
    const parsed = profileSettingsSchema.parse({
      name: ' Mi Negocio ', bio: '', profileImageUrl: '', logoUrl: '',
      whatsapp: '', instagram: '', addressText: '', city: ' Santiago ',
      subdomain: 'Mi-Negocio',
    })

    expect(parsed).toMatchObject({ name: 'Mi Negocio', city: 'Santiago', subdomain: 'mi-negocio' })
    expect('timezone' in parsed).toBe(false)
  })

  it('reservation schema keeps the empty cutoff out of its contract', () => {
    const parsed = reservationSettingsSchema.parse({
      timezone: 'America/Santiago', slotStepMinutes: 'service', manualHoldHours: '24',
      requireBookingApproval: false, defaultMeetingUrl: '',
    })

    expect(parsed.slotStepMinutes).toBe('service')
    expect('selfServiceCutoffHours' in parsed).toBe(false)
  })

  it('policy schema keeps cutoff and reminder together', () => {
    const parsed = policySettingsSchema.parse({
      selfServiceCutoffHours: '24', cancellationReminderEnabled: true,
      cancellationPolicy: '', bookingPolicy: '', depositPolicy: '',
    })

    expect(parsed.selfServiceCutoffHours).toBe(24)
  })
})

describe('profileSettingsSchema', () => {
  it('accepts valid data', () => {
    const result = profileSettingsSchema.safeParse({
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
    const result = profileSettingsSchema.safeParse({ name: '', city: 'Santiago', subdomain: 'test' })
    expect(result.success).toBe(false)
  })

  it('rejects name > 100 chars', () => {
    const result = profileSettingsSchema.safeParse({ name: 'a'.repeat(101), city: 'Santiago', subdomain: 'test' })
    expect(result.success).toBe(false)
  })

  it('transforms subdomain to lowercase', () => {
    const result = profileSettingsSchema.safeParse({ name: 'Test', city: 'Santiago', subdomain: 'MiEstudio' })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.subdomain).toBe('miestudio')
    }
  })

  it('rejects subdomain with spaces', () => {
    const result = profileSettingsSchema.safeParse({ name: 'Test', city: 'Santiago', subdomain: 'mi estudio' })
    expect(result.success).toBe(false)
  })

  it('rejects subdomain < 3 chars', () => {
    const result = profileSettingsSchema.safeParse({ name: 'Test', city: 'Santiago', subdomain: 'ab' })
    expect(result.success).toBe(false)
  })

  it('rejects invalid URL', () => {
    const result = profileSettingsSchema.safeParse({
      name: 'Test', city: 'Santiago', subdomain: 'test',
      profileImageUrl: 'not-a-url',
    })
    expect(result.success).toBe(false)
  })

  it('allows empty URL', () => {
    const result = profileSettingsSchema.safeParse({
      name: 'Test', city: 'Santiago', subdomain: 'test',
      profileImageUrl: '',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.profileImageUrl).toBe('')
    }
  })

  it('rejects empty city', () => {
    const result = profileSettingsSchema.safeParse({ name: 'Test', city: '', subdomain: 'test' })
    expect(result.success).toBe(false)
  })

  it('rejects bio > 500 chars', () => {
    const result = profileSettingsSchema.safeParse({
      name: 'Test', city: 'Santiago', subdomain: 'test',
      bio: 'a'.repeat(501),
    })
    expect(result.success).toBe(false)
  })

  it('accepts whatsapp with spaces', () => {
    const result = profileSettingsSchema.safeParse({
      name: 'Test', city: 'Santiago', subdomain: 'test',
      whatsapp: '9 1234 5678',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.whatsapp).toBe('9 1234 5678')
    }
  })

  it('accepts instagram with @', () => {
    const result = profileSettingsSchema.safeParse({
      name: 'Test', city: 'Santiago', subdomain: 'test',
      instagram: '@miestudio',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.instagram).toBe('@miestudio')
    }
  })

  it('rejects name with only spaces', () => {
    const result = profileSettingsSchema.safeParse({ name: '   ', city: 'Santiago', subdomain: 'test' })
    expect(result.success).toBe(false)
  })

  it('rejects city with only spaces', () => {
    const result = profileSettingsSchema.safeParse({ name: 'Test', city: '   ', subdomain: 'test' })
    expect(result.success).toBe(false)
  })

})

describe('reservationSettingsSchema', () => {
  it('defaults slotStepMinutes to "30" when not provided', () => {
    const result = reservationSettingsSchema.safeParse({})
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
    const result = reservationSettingsSchema.safeParse({ slotStepMinutes: '20' })
    expect(result.success).toBe(false)
  })

  it('defaults timezone when not provided', () => {
    const result = reservationSettingsSchema.safeParse({})
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.timezone).toBe('America/Santiago')
    }
  })

})

describe('policySettingsSchema', () => {
  it('selfServiceCutoffHours: default 24, rango 0-720, entero', () => {
    expect(policySettingsSchema.parse({}).selfServiceCutoffHours).toBe(24)
    expect(policySettingsSchema.parse({ selfServiceCutoffHours: 0 }).selfServiceCutoffHours).toBe(0)
    expect(() => policySettingsSchema.parse({ selfServiceCutoffHours: 721 })).toThrow()
    expect(() => policySettingsSchema.parse({ selfServiceCutoffHours: -1 })).toThrow()
    // Input vacío del form ('') debe volver al default 24, no convertirse en 0 (= sin límite).
    expect(policySettingsSchema.parse({ selfServiceCutoffHours: '' }).selfServiceCutoffHours).toBe(24)
  })

  it('defaults cancellation reminders to enabled when not provided', () => {
    const result = policySettingsSchema.parse({})

    expect(result.cancellationReminderEnabled).toBe(true)
  })
})
