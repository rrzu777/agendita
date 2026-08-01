import { describe, it, expect } from 'vitest'
import { entryStepAfterRestore, stepAfter, stepBefore, stepsFor } from '@/lib/bookings/wizard-steps'

const SIN_EQUIPO = stepsFor(null)
const CON_EQUIPO = stepsFor('Barbero')

describe('la lista de pasos', () => {
  it('sin equipo es la de siempre, seis pasos', () => {
    expect(SIN_EQUIPO.map((s) => s.key)).toEqual(['service', 'date', 'time', 'customer', 'payment', 'confirmation'])
  })

  it('con equipo mete el paso entre servicio y fecha, con el oficio del rubro', () => {
    expect(CON_EQUIPO.map((s) => s.key)).toEqual(['service', 'professional', 'date', 'time', 'customer', 'payment', 'confirmation'])
    expect(CON_EQUIPO[1].label).toBe('Barbero')
  })
})

describe('moverse por la lista', () => {
  it('el paso siguiente sale de la lista y no de un número', () => {
    expect(stepAfter(SIN_EQUIPO, 'service')).toBe('date')
    expect(stepAfter(CON_EQUIPO, 'service')).toBe('professional')
    expect(stepBefore(CON_EQUIPO, 'date')).toBe('professional')
    expect(stepBefore(SIN_EQUIPO, 'date')).toBe('service')
  })

  it('los bordes se quedan quietos', () => {
    expect(stepBefore(SIN_EQUIPO, 'service')).toBe('service')
    expect(stepAfter(SIN_EQUIPO, 'confirmation')).toBe('confirmation')
  })
})

describe('a dónde vuelve quien se fue a crear su cuenta', () => {
  const conHora = { date: new Date(), timeSlot: {}, professionalId: 'ana' }

  it('al paso más lejano que el estado sostiene', () => {
    expect(entryStepAfterRestore(conHora, false)).toBe('customer')
    expect(entryStepAfterRestore({ date: new Date(), timeSlot: null, professionalId: null }, false)).toBe('time')
    expect(entryStepAfterRestore({ date: null, timeSlot: null, professionalId: null }, false)).toBe('date')
  })

  /**
   * La persona elegida se dio de baja mientras la clienta estaba en /ingresar. La
   * hora restaurada se calculó contra SU agenda, así que mandarla a "Tus datos" con
   * ese horario sería ofrecerle algo que ya no existe.
   */
  it('con el paso pendiente, ahí queda, aunque traiga fecha y hora', () => {
    expect(entryStepAfterRestore({ ...conHora, professionalId: null }, true)).toBe('professional')
  })

  it('con la persona intacta el paso pendiente no estorba', () => {
    expect(entryStepAfterRestore(conHora, true)).toBe('customer')
  })
})
