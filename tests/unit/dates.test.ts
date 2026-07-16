import { describe, it, expect } from 'vitest'
import { isValidCalendarDate } from '@/lib/dates'

describe('isValidCalendarDate', () => {
  it('acepta fechas de calendario reales', () => {
    expect(isValidCalendarDate('1990-05-10')).toBe(true)
    expect(isValidCalendarDate('2000-02-29')).toBe(true) // bisiesto
    expect(isValidCalendarDate('2024-12-31')).toBe(true)
  })

  it('rechaza fechas que JS rodaría al período siguiente', () => {
    expect(isValidCalendarDate('2020-13-45')).toBe(false) // mes y día fuera de rango
    expect(isValidCalendarDate('1990-02-30')).toBe(false) // 30 de febrero
    expect(isValidCalendarDate('2023-02-29')).toBe(false) // no bisiesto
    expect(isValidCalendarDate('2020-00-10')).toBe(false) // mes 0
    expect(isValidCalendarDate('2020-01-00')).toBe(false) // día 0
  })
})
