import { describe, it, expect } from 'vitest'
import { formatConfirmationDateTime } from '@/app/book/confirmation/format-datetime'

// Instante UTC = 2026-07-20T00:30:00Z. En America/Santiago (UTC-4 en julio) eso
// es el domingo 19 de julio, 20:30 hora local. En UTC (Vercel) es el lunes 20,
// 00:30. El bug de la auditoría: sin timeZone, el server UTC mostraba el día/hora
// equivocados para reservas caídas ≥20:00 hora local.
const INSTANT = new Date('2026-07-20T00:30:00Z')

describe('formatConfirmationDateTime — formatea en la TZ del negocio, no la del server', () => {
  it('America/Santiago: la reserva de las 20:30 se muestra el día local correcto', () => {
    const { date, time } = formatConfirmationDateTime(INSTANT, 'America/Santiago')
    expect(date).toBe('domingo, 19 de julio')
    expect(time).toMatch(/^08:30/) // 12h es-CL: "08:30 p. m." (no 24h)
  })

  it('el mismo instante en otra TZ rinde otro día/hora (prueba que depende de la TZ)', () => {
    const { date, time } = formatConfirmationDateTime(INSTANT, 'UTC')
    expect(date).toBe('lunes, 20 de julio')
    expect(time).toMatch(/^12:30/)
  })
})
