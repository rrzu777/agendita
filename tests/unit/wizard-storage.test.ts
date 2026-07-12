import { describe, expect, it } from 'vitest'
import { serializeWizardState, restoreWizardState, wizardStorageKey } from '@/lib/booking/wizard-storage'
import type { BookingData } from '@/components/booking/wizard'

const NOW = new Date('2026-07-11T12:00:00Z').getTime()

const service = {
  id: 's1', name: 'Manicure', price: 20000, durationMinutes: 60,
  depositAmount: 5000, pastelColor: '#f4dbca', isActive: true,
} as never // Service de Prisma: solo usamos estos campos

const data: BookingData = {
  serviceId: 's1', serviceName: 'Manicure', servicePrice: 20000, serviceDuration: 60,
  serviceDeposit: 5000, serviceColor: '#f4dbca',
  date: new Date('2026-07-20T00:00:00Z'),
  timeSlot: { start: new Date('2026-07-20T15:00:00Z'), end: new Date('2026-07-20T16:00:00Z') },
  customerName: 'Maria', customerPhone: '+56911111111', customerEmail: 'maria@example.com',
  customerNotes: '', idempotencyKey: 'idem-1', promotionCode: 'PROMO',
}

describe('wizardStorageKey', () => {
  it('es por negocio', () => {
    expect(wizardStorageKey('b1')).not.toBe(wizardStorageKey('b2'))
  })
})

describe('serialize + restore round-trip', () => {
  it('restaura Dates, datos de clienta, idempotencyKey y promo, rederivando el servicio', () => {
    const raw = serializeWizardState(data, NOW)
    const restored = restoreWizardState(raw, [service], NOW + 60_000)
    expect(restored).not.toBeNull()
    expect(restored!.serviceId).toBe('s1')
    expect(restored!.serviceName).toBe('Manicure')
    expect(restored!.date).toEqual(new Date('2026-07-20T00:00:00Z'))
    expect(restored!.timeSlot).toEqual({ start: new Date('2026-07-20T15:00:00Z'), end: new Date('2026-07-20T16:00:00Z') })
    expect(restored!.customerEmail).toBe('maria@example.com')
    expect(restored!.idempotencyKey).toBe('idem-1')
    expect(restored!.promotionCode).toBe('PROMO')
  })

  it('sin servicio elegido no serializa nada', () => {
    expect(serializeWizardState({ ...data, serviceId: null }, NOW)).toBeNull()
  })

  it('expirado (>30 min) devuelve null', () => {
    const raw = serializeWizardState(data, NOW)
    expect(restoreWizardState(raw, [service], NOW + 31 * 60_000)).toBeNull()
  })

  it('servicio inexistente o inactivo descarta TODO el estado (no restaura parcial)', () => {
    const raw = serializeWizardState(data, NOW)
    expect(restoreWizardState(raw, [], NOW)).toBeNull()
    expect(restoreWizardState(raw, [{ ...(service as object), isActive: false } as never], NOW)).toBeNull()
  })

  it('JSON corrupto o null devuelve null sin lanzar', () => {
    expect(restoreWizardState('{{{', [service], NOW)).toBeNull()
    expect(restoreWizardState(null, [service], NOW)).toBeNull()
  })
})
