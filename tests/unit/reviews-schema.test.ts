import { describe, it, expect } from 'vitest'
import { submitReviewSchema } from '@/lib/reviews/schema'

describe('submitReviewSchema', () => {
  const validData = {
    bookingId: 'booking-1',
    token: 'test-token-123',
    rating: 5,
  }

  it('accepts valid data with rating 5', () => {
    const result = submitReviewSchema.safeParse(validData)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.rating).toBe(5)
      expect(result.data.bookingId).toBe('booking-1')
      expect(result.data.token).toBe('test-token-123')
      expect(result.data.comment).toBeUndefined()
    }
  })

  it('accepts rating 1', () => {
    const result = submitReviewSchema.safeParse({ ...validData, rating: 1 })
    expect(result.success).toBe(true)
  })

  it('accepts rating 3', () => {
    const result = submitReviewSchema.safeParse({ ...validData, rating: 3 })
    expect(result.success).toBe(true)
  })

  it('accepts valid data with comment', () => {
    const result = submitReviewSchema.safeParse({
      ...validData,
      comment: 'Excelente servicio',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.comment).toBe('Excelente servicio')
    }
  })

  it('accepts empty string comment', () => {
    const result = submitReviewSchema.safeParse({
      ...validData,
      comment: '',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.comment).toBe('')
    }
  })

  it('accepts null comment', () => {
    const result = submitReviewSchema.safeParse({
      ...validData,
      comment: null,
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.comment).toBeNull()
    }
  })

  it('rejects rating 0', () => {
    const result = submitReviewSchema.safeParse({ ...validData, rating: 0 })
    expect(result.success).toBe(false)
  })

  it('rejects rating 6', () => {
    const result = submitReviewSchema.safeParse({ ...validData, rating: 6 })
    expect(result.success).toBe(false)
  })

  it('rejects decimal rating', () => {
    const result = submitReviewSchema.safeParse({ ...validData, rating: 3.5 })
    expect(result.success).toBe(false)
  })

  it('rejects negative rating', () => {
    const result = submitReviewSchema.safeParse({ ...validData, rating: -1 })
    expect(result.success).toBe(false)
  })

  it('rejects missing rating', () => {
    const result = submitReviewSchema.safeParse({ bookingId: 'b1', token: 't1' })
    expect(result.success).toBe(false)
  })

  it('rejects missing token', () => {
    const result = submitReviewSchema.safeParse({ bookingId: 'b1', rating: 5 })
    expect(result.success).toBe(false)
  })

  it('rejects missing bookingId', () => {
    const result = submitReviewSchema.safeParse({ token: 't1', rating: 5 })
    expect(result.success).toBe(false)
  })

  it('rejects empty token', () => {
    const result = submitReviewSchema.safeParse({ ...validData, token: '' })
    expect(result.success).toBe(false)
  })

  it('rejects empty bookingId', () => {
    const result = submitReviewSchema.safeParse({ ...validData, bookingId: '' })
    expect(result.success).toBe(false)
  })

  it('trims comment whitespace', () => {
    const result = submitReviewSchema.safeParse({
      ...validData,
      comment: '  Buen servicio  ',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.comment).toBe('Buen servicio')
    }
  })

  it('rejects comment > 1000 chars', () => {
    const result = submitReviewSchema.safeParse({
      ...validData,
      comment: 'a'.repeat(1001),
    })
    expect(result.success).toBe(false)
  })

  it('accepts comment exactly 1000 chars', () => {
    const result = submitReviewSchema.safeParse({
      ...validData,
      comment: 'a'.repeat(1000),
    })
    expect(result.success).toBe(true)
  })

  it('strips unknown fields', () => {
    const result = submitReviewSchema.safeParse({
      ...validData,
      businessId: 'should-be-stripped',
      customerId: 'should-be-stripped',
      isApproved: true,
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect((result.data as Record<string, unknown>).businessId).toBeUndefined()
      expect((result.data as Record<string, unknown>).customerId).toBeUndefined()
      expect((result.data as Record<string, unknown>).isApproved).toBeUndefined()
    }
  })

  it('rejects non-integer rating (string)', () => {
    const result = submitReviewSchema.safeParse({ ...validData, rating: '5' })
    expect(result.success).toBe(false)
  })
})
