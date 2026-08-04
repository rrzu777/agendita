import { describe, it, expect } from 'vitest'
import { addHours } from 'date-fns'
import { holdDeadlinePhrase, holdDeadlinePromise } from '@/lib/bookings/hold'

const NOW = new Date('2026-08-03T12:00:00Z')
// NOW son las 08:00 en Santiago (UTC-4 en agosto), así que "hoy" local y "hoy"
// UTC coinciden y las horas del día se leen sin hacer la cuenta.
const TZ = 'America/Santiago'

/** Una cita de una hora que arranca dentro de `horas`. */
function cita(horas: number) {
  return addHours(NOW, horas + 1)
}

describe('holdDeadlinePromise', () => {
  it('con la cita lejos, la ventana manda y viaja con su fecha', () => {
    const holdExpiresAt = addHours(NOW, 24)
    expect(holdDeadlinePromise({ holdExpiresAt, endDateTime: cita(72) }, NOW)).toEqual({ kind: 'window', at: holdExpiresAt })
  })

  it('con la cita cerca, el techo es la cita y viaja SIN fecha', () => {
    // El caso de todos los días desde la ventana de coordinación manual: 24h de
    // plazo sobre una cita de hoy. Prometerle "hasta mañana a las 12" a alguien
    // que se atiende hoy a las 14 no es un redondeo, es una frase sin sentido.
    // Y la fecha de ese techo es el final de esa misma cita: por eso no viaja,
    // o la superficie la imprime como si fuera un dato nuevo.
    expect(holdDeadlinePromise({ holdExpiresAt: addHours(NOW, 24), endDateTime: cita(2) }, NOW)).toEqual({ kind: 'appointment' })
  })

  it('sin plazo no hay nada que prometer', () => {
    expect(holdDeadlinePromise({ holdExpiresAt: null, endDateTime: cita(72) }, NOW)).toBeNull()
  })

  it('con el plazo ya vencido tampoco', () => {
    expect(holdDeadlinePromise({ holdExpiresAt: addHours(NOW, -1), endDateTime: cita(72) }, NOW)).toBeNull()
  })

  it('con la cita ya pasada tampoco, aunque el plazo siga vivo en la base', () => {
    // Éste es el que arregla la pantalla: la ventana de 24h sigue corriendo,
    // pero "te guardamos el horario" dejó de querer decir algo.
    expect(
      holdDeadlinePromise({ holdExpiresAt: addHours(NOW, 20), endDateTime: addHours(NOW, -1) }, NOW),
    ).toBeNull()
  })

  it('lo que no es una cita (un paquete) sólo puede tener el techo de su ventana', () => {
    // `endDateTime: null` = compra de paquete: tiene hold pero no turno. Pasa
    // por acá igual para que un plazo vencido lo frene el mismo lugar que en
    // reservas, y no el `where` de la query del cron.
    const holdExpiresAt = addHours(NOW, 24)
    expect(holdDeadlinePromise({ holdExpiresAt, endDateTime: null }, NOW)).toEqual({ kind: 'window', at: holdExpiresAt })
    expect(holdDeadlinePromise({ holdExpiresAt: addHours(NOW, -1), endDateTime: null }, NOW)).toBeNull()
    expect(holdDeadlinePromise({ holdExpiresAt: null, endDateTime: null }, NOW)).toBeNull()
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
