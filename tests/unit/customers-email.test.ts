import { describe, expect, it } from 'vitest'
import { isEmailable } from '@/lib/customers/email'

describe('isEmailable', () => {
  it('accepts a normal email', () => {
    expect(isEmailable('ana@example.com')).toBe(true)
  })
  it('rejects null/empty', () => {
    expect(isEmailable(null)).toBe(false)
    expect(isEmailable(undefined)).toBe(false)
    expect(isEmailable('')).toBe(false)
    expect(isEmailable('   ')).toBe(false)
  })
  it('rejects strings without a domain dot after @', () => {
    expect(isEmailable('ana@example')).toBe(false)
    expect(isEmailable('ana.example.com')).toBe(false)
    expect(isEmailable('@example.com')).toBe(false)
    expect(isEmailable('ana@')).toBe(false)
  })
})
