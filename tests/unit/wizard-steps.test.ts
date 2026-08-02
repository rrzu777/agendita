import { describe, it, expect } from 'vitest'
import { entryStepAfterRestore, stepAfter, stepBefore, stepsFor } from '@/lib/bookings/wizard-steps'
import type { BookingData } from '@/components/booking/wizard'

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
  const base = {
    date: new Date(), timeSlot: {} as BookingData['timeSlot'],
    professional: { kind: 'person', id: 'ana' } as BookingData['professional'],
    serviceModalities: ['on_site'] as BookingData['serviceModalities'], serviceModality: 'on_site' as const,
  }

  it('al paso más lejano que el estado sostiene', () => {
    expect(entryStepAfterRestore(base, SIN_EQUIPO)).toBe('customer')
    expect(entryStepAfterRestore({ ...base, timeSlot: null }, SIN_EQUIPO)).toBe('time')
    expect(entryStepAfterRestore({ ...base, timeSlot: null, date: null }, SIN_EQUIPO)).toBe('date')
  })

  /**
   * La persona elegida se dio de baja mientras la clienta estaba en /ingresar. La
   * hora restaurada se calculó contra SU agenda, así que mandarla a "Tus datos" con
   * ese horario sería ofrecerle algo que ya no existe.
   */
  it('con el paso pendiente, ahí queda, aunque traiga fecha y hora', () => {
    expect(entryStepAfterRestore({ ...base, professional: { kind: 'none' } }, CON_EQUIPO)).toBe('professional')
  })

  it('con la persona intacta el paso pendiente no estorba', () => {
    expect(entryStepAfterRestore(base, CON_EQUIPO)).toBe('customer')
  })

  // "Cualquiera disponible" ES una respuesta, y la hora restaurada salió de la unión
  // del equipo, que no cambió por el viaje a /ingresar. Tratarla como pendiente la
  // devolvería al paso a contestar lo que ya contestó.
  it('"cualquiera" cuenta como elegido y no vuelve al paso', () => {
    expect(entryStepAfterRestore({ ...base, professional: { kind: 'anyone' } }, CON_EQUIPO)).toBe('customer')
  })

  /**
   * El "dónde" se elige adentro del paso 1, así que es el único lugar donde se puede
   * volver a preguntar. Si la dueña dejó de ofrecer la modalidad guardada, el restore
   * la descarta y sin esto nadie vuelve a preguntar: la reserva sale con la que
   * elija el servidor, y "a domicilio" se convierte en "en el local" sin avisar.
   */
  it('vuelve al servicio cuando quedó sin modalidad y el servicio ofrece varias', () => {
    expect(entryStepAfterRestore(
      { ...base, serviceModalities: ['on_site', 'at_home'], serviceModality: null },
      SIN_EQUIPO,
    )).toBe('service')
  })

  it('con una sola modalidad no hay nada que volver a preguntar', () => {
    expect(entryStepAfterRestore({ ...base, serviceModality: null }, SIN_EQUIPO)).toBe('customer')
  })
})
