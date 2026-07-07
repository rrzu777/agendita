import { describe, it, expect } from 'vitest'
import { planSeriesUpdate } from '@/lib/calendar/series-update-plan'

describe('planSeriesUpdate', () => {
  const today = '2026-07-07'
  const yesterday = '2026-07-06'

  it('parte la serie cuando hay ocurrencias pasadas y futuras (serie en curso)', () => {
    // Empezó hace tiempo, sin fin: hay pasado y futuro.
    expect(planSeriesUpdate('2020-01-06', null, today, yesterday)).toEqual({ mode: 'split', hasFuture: true })
    // Empezó ayer, termina en un mes: pasado (ayer) y futuro.
    expect(planSeriesUpdate('2026-07-05', '2026-08-02', today, yesterday)).toEqual({ mode: 'split', hasFuture: true })
  })

  it('actualiza en el lugar una serie solo-futura (aún no empieza)', () => {
    // Arranca hoy o después: no hay pasado que preservar → sin split, pero sí hay futuro.
    expect(planSeriesUpdate('2026-07-07', null, today, yesterday)).toEqual({ mode: 'in-place', hasFuture: true })
    expect(planSeriesUpdate('2026-07-13', '2026-09-01', today, yesterday)).toEqual({ mode: 'in-place', hasFuture: true })
  })

  it('actualiza en el lugar una serie ya terminada (evita la serie fantasma)', () => {
    // Este es el bug real: until en el pasado. El split la volvería anchor>until.
    expect(planSeriesUpdate('2026-07-05', '2026-07-04', today, yesterday)).toEqual({ mode: 'in-place', hasFuture: false })
    expect(planSeriesUpdate('2026-06-01', '2026-07-04', today, yesterday)).toEqual({ mode: 'in-place', hasFuture: false })
  })

  it('parte cuando la serie termina exactamente hoy (hoy aún es futuro-inclusive)', () => {
    expect(planSeriesUpdate('2026-06-01', '2026-07-07', today, yesterday)).toEqual({ mode: 'split', hasFuture: true })
  })
})
