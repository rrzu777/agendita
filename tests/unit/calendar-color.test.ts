import { describe, it, expect } from 'vitest'
import { parseHex, relativeLuminance, contrastRatio } from '@/lib/calendar/color'

describe('parseHex', () => {
  it('parsea hex con y sin #', () => {
    expect(parseHex('#FFB3BA')).toEqual({ r: 255, g: 179, b: 186 })
    expect(parseHex('FFB3BA')).toEqual({ r: 255, g: 179, b: 186 })
  })
  it('devuelve null para valores inválidos o ausentes', () => {
    expect(parseHex('nope')).toBeNull()
    expect(parseHex('#FFF')).toBeNull()
    expect(parseHex(undefined)).toBeNull()
    expect(parseHex(null)).toBeNull()
  })
})

describe('relativeLuminance', () => {
  it('blanco ~1 y negro ~0', () => {
    expect(relativeLuminance('#FFFFFF')).toBeCloseTo(1, 2)
    expect(relativeLuminance('#000000')).toBeCloseTo(0, 2)
  })
})

describe('contrastRatio', () => {
  it('blanco vs negro es 21:1', () => {
    expect(contrastRatio('#FFFFFF', '#000000')).toBeCloseTo(21, 0)
  })
  it('mismo color es 1:1', () => {
    expect(contrastRatio('#123456', '#123456')).toBeCloseTo(1, 5)
  })
})
