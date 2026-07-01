import { describe, expect, it } from 'vitest'
import { formatDuration } from '@/lib/format-duration'

describe('formatDuration', () => {
  it('formats minutes under one hour', () => {
    expect(formatDuration(45)).toBe('45 min')
  })

  it('formats full hours', () => {
    expect(formatDuration(120)).toBe('2 h')
  })

  it('formats hours with remaining minutes', () => {
    expect(formatDuration(195)).toBe('3 h 15 min')
  })
})
