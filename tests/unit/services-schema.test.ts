import { describe, it, expect } from 'vitest'
import { createServiceSchema, updateServiceSchema, reorderSchema } from '@/lib/services/schema'

const validService = {
  name: 'Corte de pelo',
  description: 'Corte clásico con tijera',
  durationMinutes: 30,
  price: 15000,
  depositAmount: 5000,
  pastelColor: '#FFB3BA',
}

describe('createServiceSchema', () => {
  it('accepts valid data', () => {
    const result = createServiceSchema.safeParse(validService)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.name).toBe('Corte de pelo')
      expect(result.data.durationMinutes).toBe(30)
      expect(result.data.price).toBe(15000)
      expect(result.data.depositAmount).toBe(5000)
      expect(result.data.pastelColor).toBe('#FFB3BA')
    }
  })

  it('accepts deposit equal to price', () => {
    const result = createServiceSchema.safeParse({ ...validService, depositAmount: 15000 })
    expect(result.success).toBe(true)
  })

  it('accepts zero deposit', () => {
    const result = createServiceSchema.safeParse({ ...validService, depositAmount: 0 })
    expect(result.success).toBe(true)
  })

  it('accepts optional fields', () => {
    const result = createServiceSchema.safeParse({
      ...validService,
      isActive: false,
      sortOrder: 5,
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.isActive).toBe(false)
      expect(result.data.sortOrder).toBe(5)
    }
  })

  it('accepts null description', () => {
    const result = createServiceSchema.safeParse({ ...validService, description: null })
    expect(result.success).toBe(true)
  })

  it('strips unknown fields', () => {
    const result = createServiceSchema.safeParse({ ...validService, businessId: 'other-biz', extraField: 'nope' })
    expect(result.success).toBe(true)
    if (result.success) {
      expect((result.data as Record<string, unknown>).businessId).toBeUndefined()
      expect((result.data as Record<string, unknown>).extraField).toBeUndefined()
    }
  })

  it('trims name', () => {
    const result = createServiceSchema.safeParse({ ...validService, name: '  Corte de pelo  ' })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.name).toBe('Corte de pelo')
    }
  })

  it('rejects empty name', () => {
    const result = createServiceSchema.safeParse({ ...validService, name: '' })
    expect(result.success).toBe(false)
  })

  it('rejects whitespace-only name', () => {
    const result = createServiceSchema.safeParse({ ...validService, name: '   ' })
    expect(result.success).toBe(false)
  })

  it('rejects name > 100 chars', () => {
    const result = createServiceSchema.safeParse({ ...validService, name: 'a'.repeat(101) })
    expect(result.success).toBe(false)
  })

  it('rejects duration < 15', () => {
    const result = createServiceSchema.safeParse({ ...validService, durationMinutes: 10 })
    expect(result.success).toBe(false)
  })

  it('rejects duration > 480', () => {
    const result = createServiceSchema.safeParse({ ...validService, durationMinutes: 500 })
    expect(result.success).toBe(false)
  })

  it('rejects duration not integer', () => {
    const result = createServiceSchema.safeParse({ ...validService, durationMinutes: 30.5 })
    expect(result.success).toBe(false)
  })

  it('rejects negative price', () => {
    const result = createServiceSchema.safeParse({ ...validService, price: -1000 })
    expect(result.success).toBe(false)
  })

  it('rejects price not integer', () => {
    const result = createServiceSchema.safeParse({ ...validService, price: 15000.5 })
    expect(result.success).toBe(false)
  })

  it('rejects negative deposit', () => {
    const result = createServiceSchema.safeParse({ ...validService, depositAmount: -1000 })
    expect(result.success).toBe(false)
  })

  it('rejects deposit not integer', () => {
    const result = createServiceSchema.safeParse({ ...validService, depositAmount: 5000.5 })
    expect(result.success).toBe(false)
  })

  it('rejects deposit > price', () => {
    const result = createServiceSchema.safeParse({ ...validService, price: 10000, depositAmount: 15000 })
    expect(result.success).toBe(false)
    if (!result.success) {
      const depositIssue = result.error.issues.find(i => i.path.includes('depositAmount'))
      expect(depositIssue).toBeDefined()
    }
  })

  it('rejects invalid hex color (no #)', () => {
    const result = createServiceSchema.safeParse({ ...validService, pastelColor: 'FFB3BA' })
    expect(result.success).toBe(false)
  })

  it('rejects invalid hex color (wrong length)', () => {
    const result = createServiceSchema.safeParse({ ...validService, pastelColor: '#FFB3B' })
    expect(result.success).toBe(false)
  })

  it('rejects invalid hex color (non-hex chars)', () => {
    const result = createServiceSchema.safeParse({ ...validService, pastelColor: '#FFB3GG' })
    expect(result.success).toBe(false)
  })

  it('rejects invalid hex color (lowercase ok)', () => {
    const result = createServiceSchema.safeParse({ ...validService, pastelColor: '#ffb3ba' })
    expect(result.success).toBe(true)
  })

  it('rejects negative sortOrder', () => {
    const result = createServiceSchema.safeParse({ ...validService, sortOrder: -1 })
    expect(result.success).toBe(false)
  })

  it('rejects non-integer sortOrder', () => {
    const result = createServiceSchema.safeParse({ ...validService, sortOrder: 1.5 })
    expect(result.success).toBe(false)
  })

  it('rejects missing required fields', () => {
    const result = createServiceSchema.safeParse({})
    expect(result.success).toBe(false)
  })
})

describe('updateServiceSchema', () => {
  it('allows partial updates', () => {
    const result = updateServiceSchema.safeParse({ name: 'Nuevo nombre' })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.name).toBe('Nuevo nombre')
      expect(result.data.description).toBeUndefined()
    }
  })

  it('allows empty object (no changes)', () => {
    const result = updateServiceSchema.safeParse({})
    expect(result.success).toBe(true)
  })

  it('rejects invalid field values same as create', () => {
    const result = updateServiceSchema.safeParse({ durationMinutes: 5 })
    expect(result.success).toBe(false)
  })

  it('strips unknown fields', () => {
    const result = updateServiceSchema.safeParse({ name: 'Test', businessId: 'malicious' })
    expect(result.success).toBe(true)
    if (result.success) {
      expect((result.data as Record<string, unknown>).businessId).toBeUndefined()
    }
  })
})

describe('reorderSchema', () => {
  it('accepts valid reorder items', () => {
    const result = reorderSchema.safeParse({
      items: [
        { id: 'svc-1', sortOrder: 0 },
        { id: 'svc-2', sortOrder: 1 },
      ],
    })
    expect(result.success).toBe(true)
  })

  it('rejects empty array', () => {
    const result = reorderSchema.safeParse({ items: [] })
    expect(result.success).toBe(true)
  })

  it('rejects missing id', () => {
    const result = reorderSchema.safeParse({ items: [{ sortOrder: 0 }] })
    expect(result.success).toBe(false)
  })

  it('rejects negative sortOrder', () => {
    const result = reorderSchema.safeParse({ items: [{ id: 'svc-1', sortOrder: -1 }] })
    expect(result.success).toBe(false)
  })

  it('rejects non-integer sortOrder', () => {
    const result = reorderSchema.safeParse({ items: [{ id: 'svc-1', sortOrder: 1.5 }] })
    expect(result.success).toBe(false)
  })
})
