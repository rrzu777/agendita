import { describe, it, expect } from 'vitest'
import { bookingAppearance } from '@/lib/calendar/booking-appearance'
import { DEFAULT_SERVICE_COLOR } from '@/lib/calendar/color'

describe('bookingAppearance', () => {
  it('confirmada: relleno = color de servicio, opacidad plena, sin tachado', () => {
    const a = bookingAppearance('#FFB3BA', 'confirmed')
    expect(a.background).toBe('#FFB3BA')
    expect(a.opacity).toBe(1)
    expect(a.strikeThrough).toBe(false)
    expect(a.icon).toBe('check')
    expect(a.textColor).toBe('#1f2937')
  })
  it('pendiente de pago: ícono reloj, opacidad plena', () => {
    const a = bookingAppearance('#FFB3BA', 'pending_payment')
    expect(a.icon).toBe('clock')
    expect(a.opacity).toBe(1)
    expect(a.strikeThrough).toBe(false)
  })
  it('completada: levemente atenuada, sin tachado', () => {
    const a = bookingAppearance('#FFB3BA', 'completed')
    expect(a.opacity).toBe(0.85)
    expect(a.strikeThrough).toBe(false)
  })
  it('cancelada: atenuada, tachada, ícono x', () => {
    const a = bookingAppearance('#FFB3BA', 'cancelled')
    expect(a.opacity).toBe(0.55)
    expect(a.strikeThrough).toBe(true)
    expect(a.icon).toBe('x')
  })
  it('expirada: atenuada, tachada, ícono dash', () => {
    const a = bookingAppearance('#FFB3BA', 'expired')
    expect(a.opacity).toBe(0.55)
    expect(a.strikeThrough).toBe(true)
    expect(a.icon).toBe('dash')
  })
  it('estado desconocido: fallback seguro (plena, sin tachado)', () => {
    const a = bookingAppearance('#FFB3BA', 'weird_status')
    expect(a.opacity).toBe(1)
    expect(a.strikeThrough).toBe(false)
    expect(a.icon).toBe('dash')
  })
  it('sin color de servicio: usa el color por defecto', () => {
    const a = bookingAppearance(undefined, 'confirmed')
    expect(a.background).toBe(DEFAULT_SERVICE_COLOR)
  })
  it('color inválido: usa el color por defecto', () => {
    const a = bookingAppearance('nope', 'confirmed')
    expect(a.background).toBe(DEFAULT_SERVICE_COLOR)
  })
})
