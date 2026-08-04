import { describe, it, expect } from 'vitest'
import { addHours } from 'date-fns'
import { holdDeadlinePhrase, promisableHoldDeadline } from '@/lib/bookings/hold'

const NOW = new Date('2026-08-03T12:00:00Z')
// NOW son las 08:00 en Santiago (UTC-4 en agosto), así que "hoy" local y "hoy"
// UTC coinciden y las horas del día se leen sin hacer la cuenta.
const TZ = 'America/Santiago'

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

describe('holdDeadlinePhrase', () => {
  it('cuando el techo es la cita lo dice en palabras, no con la hora del turno', () => {
    // Lo que veía la clienta antes: "hasta el 03-08-2026 14:00", que es el
    // final de su propia cita y se lee como un dato nuevo.
    expect(holdDeadlinePhrase({ holdExpiresAt: addHours(NOW, 24), endDateTime: cita(1) }, TZ, NOW)).toBe('tu cita')
  })

  it('un plazo de hoy va sin fecha: alcanza la hora', () => {
    // El formato es el de la confirmación: 12h es-CL ("10:00 a. m.").
    expect(holdDeadlinePhrase({ holdExpiresAt: addHours(NOW, 2), endDateTime: cita(72) }, TZ, NOW)).toMatch(/^las 10:00/)
  })

  it('un plazo de otro día lleva la fecha, o mentiría el día', () => {
    const frase = holdDeadlinePhrase({ holdExpiresAt: addHours(NOW, 24), endDateTime: cita(72) }, TZ, NOW)
    expect(frase).toContain('martes')
    expect(frase).toContain('4 de agosto')
    expect(frase).toContain('08:00')
  })

  it('sin nada que prometer no hay frase', () => {
    expect(holdDeadlinePhrase({ holdExpiresAt: null, endDateTime: cita(72) }, TZ, NOW)).toBeNull()
    expect(holdDeadlinePhrase({ holdExpiresAt: addHours(NOW, -1), endDateTime: cita(72) }, TZ, NOW)).toBeNull()
    expect(holdDeadlinePhrase({ holdExpiresAt: addHours(NOW, 20), endDateTime: addHours(NOW, -1) }, TZ, NOW)).toBeNull()
  })

  it('la hora es la del negocio, no la del server', () => {
    // Mismo instante, dos husos: si esto se rompiera, el plazo saldría con la
    // hora de Vercel (UTC) y la clienta leería tres horas de más.
    expect(holdDeadlinePhrase({ holdExpiresAt: addHours(NOW, 2), endDateTime: cita(72) }, 'UTC', NOW)).toMatch(/^las 02:00 p/)
  })
})
