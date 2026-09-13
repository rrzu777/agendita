import { describe, expect, it } from 'vitest'
import { updateServiceSchema } from '@/lib/services/schema'
describe('optional catalogue category', () => {
  it('trims, permits clearing, rejects overly long categories and does not invent one for legacy updates', () => {
    expect(updateServiceSchema.parse({ category: '  Barbería  ' })).toEqual({ category: 'Barbería' })
    expect(updateServiceSchema.parse({ category: '' })).toEqual({ category: null })
    expect(updateServiceSchema.safeParse({ category: 'x'.repeat(61) }).success).toBe(false)
    expect(updateServiceSchema.parse({ name: 'Corte' })).toEqual({ name: 'Corte' })
  })
})
