import { describe, it, expect } from 'vitest'
import {
  parseHex,
  relativeLuminance,
  contrastRatio,
  readableTextColor,
  deriveBorderColor,
  DEFAULT_SERVICE_COLOR,
} from '@/lib/calendar/color'

const DARK_TEXT = '#1f2937'
const LIGHT_TEXT = '#ffffff'

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

describe('readableTextColor', () => {
  it('elige texto oscuro sobre pastel claro', () => {
    expect(readableTextColor('#FFB3BA')).toBe(DARK_TEXT)
  })
  it('elige texto claro sobre fondo oscuro', () => {
    expect(readableTextColor('#1a1a2e')).toBe(LIGHT_TEXT)
  })
  it('el color elegido cumple contraste >= 4.5:1', () => {
    for (const bg of ['#FFB3BA', '#1a1a2e', '#c7f9cc', '#2b2d42']) {
      expect(contrastRatio(bg, readableTextColor(bg))).toBeGreaterThanOrEqual(4.5)
    }
  })
})

describe('deriveBorderColor', () => {
  it('devuelve un tono más oscuro que el fondo', () => {
    const bg = '#FFB3BA'
    expect(relativeLuminance(deriveBorderColor(bg))).toBeLessThan(relativeLuminance(bg))
  })
  it('para hex inválido usa el color por defecto', () => {
    expect(deriveBorderColor('nope')).toBe(deriveBorderColor(DEFAULT_SERVICE_COLOR))
  })
})
