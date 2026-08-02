import { describe, it, expect, vi } from 'vitest'
import type { Booking } from '@prisma/client'

// El guard que se prueba acá corre ANTES de tocar la base, así que alcanza con que
// estos módulos existan: si alguno se llegara a usar, el test lo delataría fallando
// por otro lado en vez de pasar de casualidad.
vi.mock('@/lib/db', () => ({ prisma: {} }))
vi.mock('@/lib/availability/validation', () => ({
  assertSlotFreeOfConflicts: vi.fn().mockRejectedValue(new Error('no debería llegar acá')),
}))

const { resumeBookingForRetry } = await import('@/lib/bookings/retry')

const INICIO = new Date('2026-06-15T14:00:00Z')

const guardada = {
  id: 'bk-1',
  serviceId: 'svc-1',
  startDateTime: INICIO,
  professionalId: 'juan',
  status: 'pending_payment',
} as unknown as Booking

const ctx = {
  serviceId: 'svc-1',
  startDateTime: INICIO,
  professional: { kind: 'person' as const, id: 'juan' },
  timezone: 'America/Santiago',
  holdMinutes: 15,
}

/**
 * La `idempotencyKey` identifica UN intento. El wizard la suelta al cambiar de hora,
 * de servicio o de persona, así que desde nuestra pantalla esto no pasa; este chequeo
 * es el fail-closed para cualquier otro cliente, y por eso tiene que mirar las tres
 * cosas que definen la cita, no dos.
 */
describe('el reintento con la misma key mira también con quién', () => {
  it('rechaza el reintento que pide otra persona', async () => {
    await expect(resumeBookingForRetry(guardada, { ...ctx, professional: { kind: 'person', id: 'ana' } }))
      .rejects.toThrow('Esa reserva es de otro horario.')
  })

  // Una reserva vieja sin persona no se puede resumir a nombre de alguien: sería
  // cobrar por una cita con quien la reserva guardada no tiene.
  it('rechaza pedir persona sobre una reserva que no tenía', async () => {
    await expect(resumeBookingForRetry({ ...guardada, professionalId: null } as Booking, ctx))
      .rejects.toThrow('Esa reserva es de otro horario.')
  })

  it('sigue rechazando por horario y por servicio', async () => {
    await expect(resumeBookingForRetry(guardada, { ...ctx, startDateTime: new Date('2026-06-15T15:00:00Z') }))
      .rejects.toThrow('Esa reserva es de otro horario.')
    await expect(resumeBookingForRetry(guardada, { ...ctx, serviceId: 'svc-2' }))
      .rejects.toThrow('Esa reserva es de otro horario.')
  })

  /**
   * Quien pidió "cualquiera" no eligió a nadie: la persona que asignó el primer
   * intento cumple igual lo que se está pidiendo ahora. Compararla contra `null`
   * rechazaría TODOS los reintentos de ese camino —el más común, porque es la opción
   * que va primero— y la clienta quedaría sin poder volver a pagar su propia reserva.
   */
  it('con "cualquiera" acepta a quien haya quedado asignado', async () => {
    const res = await resumeBookingForRetry(
      { ...guardada, status: 'confirmed' } as Booking,
      { ...ctx, professional: { kind: 'anyone' } },
    )
    expect(res?.id).toBe('bk-1')
  })
})
