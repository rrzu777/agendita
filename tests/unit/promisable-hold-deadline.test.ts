import { describe, it, expect } from 'vitest'
import { addHours } from 'date-fns'
import { promisableHoldDeadline } from '@/lib/bookings/hold'

const NOW = new Date('2026-08-03T12:00:00Z')

/** Una cita de una hora que arranca dentro de `horas`. */
function cita(horas: number) {
  return addHours(NOW, horas + 1)
}

describe('promisableHoldDeadline', () => {
  it('con la cita lejos, la ventana manda', () => {
    const holdExpiresAt = addHours(NOW, 24)
    expect(promisableHoldDeadline({ holdExpiresAt, endDateTime: cita(72) }, NOW)).toEqual(holdExpiresAt)
  })

  it('con la cita cerca, el techo es la cita', () => {
    // El caso de todos los días desde la ventana de coordinación manual: 24h de
    // plazo sobre una cita de hoy. Prometerle "hasta mañana a las 12" a alguien
    // que se atiende hoy a las 14 no es un redondeo, es una frase sin sentido.
    const endDateTime = cita(2)
    expect(promisableHoldDeadline({ holdExpiresAt: addHours(NOW, 24), endDateTime }, NOW)).toEqual(endDateTime)
  })

  it('sin plazo no hay nada que prometer', () => {
    expect(promisableHoldDeadline({ holdExpiresAt: null, endDateTime: cita(72) }, NOW)).toBeNull()
  })

  it('con el plazo ya vencido tampoco', () => {
    expect(promisableHoldDeadline({ holdExpiresAt: addHours(NOW, -1), endDateTime: cita(72) }, NOW)).toBeNull()
  })

  it('con la cita ya pasada tampoco, aunque el plazo siga vivo en la base', () => {
    // Éste es el que arregla la pantalla: la ventana de 24h sigue corriendo,
    // pero "te guardamos el horario" dejó de querer decir algo.
    expect(
      promisableHoldDeadline({ holdExpiresAt: addHours(NOW, 20), endDateTime: addHours(NOW, -1) }, NOW),
    ).toBeNull()
  })

  it('el valor devuelto identifica quién puso el techo', () => {
    // El caller distingue "hasta las 18:00" de "hasta tu cita" comparando con
    // endDateTime; si esto dejara de valer, el copy se vuelve circular.
    const endDateTime = cita(2)
    const topada = promisableHoldDeadline({ holdExpiresAt: addHours(NOW, 24), endDateTime }, NOW)
    const suelta = promisableHoldDeadline({ holdExpiresAt: addHours(NOW, 1), endDateTime }, NOW)
    expect(topada!.getTime()).toBe(endDateTime.getTime())
    expect(suelta!.getTime()).not.toBe(endDateTime.getTime())
  })
})
