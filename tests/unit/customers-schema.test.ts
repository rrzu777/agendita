import { describe, it, expect } from 'vitest'
import { updateCustomerSchema, updateCustomerNotesSchema } from '@/lib/customers/schema'

const validCustomer = {
  name: 'Maria Garcia',
  phone: '56912345678',
}

describe('updateCustomerSchema', () => {
  it('accepts valid data', () => {
    const result = updateCustomerSchema.safeParse(validCustomer)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.name).toBe('Maria Garcia')
      expect(result.data.phone).toBe('56912345678')
      expect(result.data.email).toBeUndefined()
    }
  })

  it('accepts data with valid email', () => {
    const result = updateCustomerSchema.safeParse({
      ...validCustomer,
      email: 'maria@ejemplo.com',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.email).toBe('maria@ejemplo.com')
    }
  })

  it('trims and lowercases email', () => {
    const result = updateCustomerSchema.safeParse({
      ...validCustomer,
      email: '  MARIA@EJEMPLO.COM  ',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.email).toBe('maria@ejemplo.com')
    }
  })

  it('accepts null email', () => {
    const result = updateCustomerSchema.safeParse({
      ...validCustomer,
      email: null,
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.email).toBeNull()
    }
  })

  it('accepts empty string email', () => {
    const result = updateCustomerSchema.safeParse({
      ...validCustomer,
      email: '',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.email).toBe('')
    }
  })

  it('rejects empty name', () => {
    const result = updateCustomerSchema.safeParse({
      ...validCustomer,
      name: '',
    })
    expect(result.success).toBe(false)
  })

  it('rejects whitespace-only name', () => {
    const result = updateCustomerSchema.safeParse({
      ...validCustomer,
      name: '   ',
    })
    expect(result.success).toBe(false)
  })

  it('trims name', () => {
    const result = updateCustomerSchema.safeParse({
      ...validCustomer,
      name: '  Maria Garcia  ',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.name).toBe('Maria Garcia')
    }
  })

  it('rejects name > 100 chars', () => {
    const result = updateCustomerSchema.safeParse({
      ...validCustomer,
      name: 'a'.repeat(101),
    })
    expect(result.success).toBe(false)
  })

  it('rejects invalid email', () => {
    const result = updateCustomerSchema.safeParse({
      ...validCustomer,
      email: 'not-an-email',
    })
    expect(result.success).toBe(false)
  })

  it('rejects phone too short', () => {
    const result = updateCustomerSchema.safeParse({
      ...validCustomer,
      phone: '1234567',
    })
    expect(result.success).toBe(false)
  })

  it('trims phone', () => {
    const result = updateCustomerSchema.safeParse({
      ...validCustomer,
      phone: '  56912345678  ',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.phone).toBe('56912345678')
    }
  })

  it('normlizes Chilean mobile without country code (9 XXXXXXXX)', () => {
    const result = updateCustomerSchema.safeParse({
      ...validCustomer,
      phone: '9 1234 5678',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.phone).toBe('56912345678')
    }
  })

  it('normlizes Chilean mobile with + and spaces (+56 9 1234 5678)', () => {
    const result = updateCustomerSchema.safeParse({
      ...validCustomer,
      phone: '+56 9 1234 5678',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.phone).toBe('56912345678')
    }
  })

  it('keeps already normalized Chilean mobile (56912345678)', () => {
    const result = updateCustomerSchema.safeParse({
      ...validCustomer,
      phone: '56912345678',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.phone).toBe('56912345678')
    }
  })

  it('normlizes phone with + prefix (+56912345678)', () => {
    const result = updateCustomerSchema.safeParse({
      ...validCustomer,
      phone: '+56912345678',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.phone).toBe('56912345678')
    }
  })

  it('strips dashes and parentheses from phone', () => {
    const result = updateCustomerSchema.safeParse({
      ...validCustomer,
      phone: '56 (9) 1234-5678',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.phone).toBe('56912345678')
    }
  })

  it('rejects phone too short after normalization', () => {
    const result = updateCustomerSchema.safeParse({
      ...validCustomer,
      phone: '9 123',
    })
    expect(result.success).toBe(false)
  })

  it('strips unknown fields', () => {
    const result = updateCustomerSchema.safeParse({
      ...validCustomer,
      businessId: 'malicious',
      extraField: 'nope',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect((result.data as Record<string, unknown>).businessId).toBeUndefined()
      expect((result.data as Record<string, unknown>).extraField).toBeUndefined()
    }
  })

  it('rejects missing required fields', () => {
    const result = updateCustomerSchema.safeParse({})
    expect(result.success).toBe(false)
  })

  it('rejects missing name', () => {
    const result = updateCustomerSchema.safeParse({ phone: '56912345678' })
    expect(result.success).toBe(false)
  })

  it('rejects missing phone', () => {
    const result = updateCustomerSchema.safeParse({ name: 'Maria' })
    expect(result.success).toBe(false)
  })

  it('accepts a valid birthDate', () => {
    const result = updateCustomerSchema.safeParse({ ...validCustomer, birthDate: '1990-05-15' })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.birthDate).toBe('1990-05-15')
    }
  })

  it('normalizes empty-string birthDate to null', () => {
    const result = updateCustomerSchema.safeParse({ ...validCustomer, birthDate: '' })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.birthDate).toBeNull()
    }
  })

  it('accepts null birthDate', () => {
    const result = updateCustomerSchema.safeParse({ ...validCustomer, birthDate: null })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.birthDate).toBeNull()
    }
  })

  it('treats a missing birthDate as null', () => {
    const result = updateCustomerSchema.safeParse(validCustomer)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.birthDate).toBeNull()
    }
  })

  it('rejects a malformed birthDate', () => {
    const result = updateCustomerSchema.safeParse({ ...validCustomer, birthDate: '15-05-1990' })
    expect(result.success).toBe(false)
  })

  it('rejects a future birthDate', () => {
    const result = updateCustomerSchema.safeParse({ ...validCustomer, birthDate: '2999-01-01' })
    expect(result.success).toBe(false)
  })

  it('rejects a birthDate before 1900', () => {
    const result = updateCustomerSchema.safeParse({ ...validCustomer, birthDate: '1899-12-31' })
    expect(result.success).toBe(false)
  })
})

describe('updateCustomerNotesSchema', () => {
  it('accepts valid notes', () => {
    const result = updateCustomerNotesSchema.safeParse({
      notes: 'Prefiere horario de tarde. Es alergica al esmalte rojo.',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.notes).toBe('Prefiere horario de tarde. Es alergica al esmalte rojo.')
    }
  })

  it('accepts null notes', () => {
    const result = updateCustomerNotesSchema.safeParse({ notes: null })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.notes).toBeNull()
    }
  })

  it('accepts empty string notes', () => {
    const result = updateCustomerNotesSchema.safeParse({ notes: '' })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.notes).toBe('')
    }
  })

  it('trims notes', () => {
    const result = updateCustomerNotesSchema.safeParse({
      notes: '  Prefiere horario de tarde.  ',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.notes).toBe('Prefiere horario de tarde.')
    }
  })

  it('rejects notes > 2000 chars', () => {
    const result = updateCustomerNotesSchema.safeParse({
      notes: 'a'.repeat(2001),
    })
    expect(result.success).toBe(false)
  })

  it('accepts notes at exactly 2000 chars', () => {
    const result = updateCustomerNotesSchema.safeParse({
      notes: 'a'.repeat(2000),
    })
    expect(result.success).toBe(true)
  })

  it('strips unknown fields', () => {
    const result = updateCustomerNotesSchema.safeParse({
      notes: 'Test',
      customerId: 'malicious',
      extraField: 'nope',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect((result.data as Record<string, unknown>).customerId).toBeUndefined()
      expect((result.data as Record<string, unknown>).extraField).toBeUndefined()
    }
  })
})
