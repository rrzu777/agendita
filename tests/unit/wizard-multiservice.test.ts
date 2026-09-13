import { describe, expect, it } from 'vitest'
import type { Service } from '@prisma/client'
import { wizardServiceFields } from '@/lib/bookings/wizard-selection'
import { restoreWizardState, serializeWizardState } from '@/lib/bookings/wizard-storage'
import type { BookingData } from '@/components/booking/wizard'

const services = [
  { id: 'cut', name: 'Corte', price: 15000, depositAmount: 5000, durationMinutes: 45, isActive: true, modalities: ['on_site'], pastelColor: '#ffffff' },
  { id: 'nose', name: 'Nasal', price: 4000, depositAmount: 1000, durationMinutes: 20, isActive: true, modalities: ['on_site'], pastelColor: '#ffffff' },
] as Service[]
describe('wizard multi-service selection', () => {
  it('derives all totals and ordered lines from the current catalogue', () => {
    expect(wizardServiceFields(['cut', 'nose'], services)).toMatchObject({ serviceId: 'cut', serviceIds: ['cut', 'nose'], serviceName: 'Corte + Nasal', servicePrice: 19000, serviceDuration: 65, serviceDeposit: 6000, serviceModalities: ['on_site'] })
  })
  it('rejects invalid or incompatible selections and supports removing the last line', () => {
    expect(() => wizardServiceFields(['cut', 'cut'], services)).toThrow()
    expect(() => wizardServiceFields(['cut', 'missing'], services)).toThrow()
    expect(() => wizardServiceFields(['cut', 'nose'], [services[0], { ...services[1], modalities: ['online'] }])).toThrow()
    expect(wizardServiceFields([], services)).toMatchObject({ serviceId: null, serviceIds: [], servicePrice: 0 })
  })
  it('restores both services and drops stale duration/identity while preserving customer data', () => {
    const data = { ...wizardServiceFields(['cut', 'nose'], services), serviceModality: 'on_site', serviceAddress: '', professional: { kind: 'none' }, professionalName: '', date: new Date('2026-09-20T12:00:00Z'), timeSlot: { start: new Date('2026-09-20T12:00:00Z'), end: new Date('2026-09-20T13:05:00Z') }, customerName: 'Guest', customerPhone: '+56900000000', customerEmail: '', customerNotes: '', idempotencyKey: 'draft-key' } as BookingData
    const raw = serializeWizardState(data)
    expect(restoreWizardState(raw, services, [])).toMatchObject({ serviceIds: ['cut', 'nose'], serviceDuration: 65, idempotencyKey: 'draft-key' })
    expect(restoreWizardState(raw, [services[0], { ...services[1], durationMinutes: 30 }], [])).toMatchObject({ customerName: 'Guest', timeSlot: null, idempotencyKey: null })
    expect(restoreWizardState(raw, [services[0]], [])).toBeNull()
  })
})
