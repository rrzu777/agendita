import { beforeEach, describe, expect, it, vi } from 'vitest'
const db = vi.hoisted(() => ({ service: { findFirst: vi.fn(), findMany: vi.fn() } }))
vi.mock('@/lib/db', () => ({ prisma: db }))
import { resolveBookingDraft } from '@/lib/bookings/draft'
import { professionalEligibilityWhere, professionalChoiceForServices } from '@/lib/professionals/eligible'

const services = [
  { id: 'cut', businessId: 'salon', isActive: true, name: 'Corte', price: 15000, depositAmount: 5000, durationMinutes: 45, modalities: ['on_site'] },
  { id: 'nose', businessId: 'salon', isActive: true, name: 'Nasal', price: 4000, depositAmount: 1000, durationMinutes: 20, modalities: ['on_site', 'at_home'] },
]
const args = { businessId: 'salon', serviceIds: ['cut', 'nose'], startDateTime: new Date('2026-09-14T13:00:00Z'), defaultMeetingUrl: null }
beforeEach(() => { vi.clearAllMocks(); db.service.findMany.mockResolvedValue(services); db.service.findFirst.mockResolvedValue(services[0]) })
describe('authoritative multiservice draft', () => {
  it('adds the complete duration, price and deposit and creates ordered snapshot lines', async () => {
    const draft = await resolveBookingDraft(args)
    expect(draft).toMatchObject({ totalPrice: 19000, depositRequired: 6000, finalAmount: 19000, modality: 'on_site' })
    expect(draft.endDateTime.toISOString()).toBe('2026-09-14T14:05:00.000Z')
    expect(draft.lines.map(l => l.serviceId)).toEqual(['cut', 'nose'])
    expect(db.service.findMany).toHaveBeenCalledWith({ where: { id: { in: ['cut', 'nose'] }, businessId: 'salon', isActive: true } })
  })
  it('preserves legacy one-service input', async () => {
    const draft = await resolveBookingDraft({ ...args, serviceIds: undefined, serviceId: 'cut' })
    expect(draft.totalPrice).toBe(15000)
    expect(draft.lines).toHaveLength(1)
  })
  it('rejects contradictory legacy pointer before a database query', async () => {
    await expect(resolveBookingDraft({ ...args, serviceId: 'nose' })).rejects.toThrow()
    expect(db.service.findMany).not.toHaveBeenCalled()
  })
  it('rejects wrong-tenant and inactive catalogue results', async () => {
    db.service.findMany.mockResolvedValue([services[0], { ...services[1], businessId: 'other' }])
    await expect(resolveBookingDraft(args)).rejects.toThrow('no está disponible')
  })
})

describe('one professional must offer every service', () => {
  const professionals = [
    { id: 'ana', name: 'Ana', bio: null, modalities: ['on_site' as const], serviceIds: ['cut'] },
    { id: 'bea', name: 'Bea', bio: null, modalities: ['on_site' as const], serviceIds: ['cut', 'nose'] },
  ]
  it('selects only the intersection, not the union', () => {
    expect(professionalChoiceForServices(professionals, ['cut', 'nose'], 'on_site')).toEqual({ kind: 'auto', professional: professionals[1] })
    expect(professionalEligibilityWhere(['cut', 'nose'], 'on_site')).toEqual({
      AND: [{ services: { some: { id: 'cut' } } }, { services: { some: { id: 'nose' } } }], modalities: { has: 'on_site' },
    })
  })
  it('distinguishes no team from an incompatible active team', () => {
    expect(professionalChoiceForServices([], ['cut', 'nose'], 'on_site')).toEqual({ kind: 'none' })
    expect(professionalChoiceForServices([professionals[0]], ['cut', 'nose'], 'on_site')).toEqual({ kind: 'unavailable' })
  })
  it('preserves single-service SQL predicate compatibility', () => {
    expect(professionalEligibilityWhere(['cut'], 'on_site')).toEqual(professionalEligibilityWhere('cut', 'on_site'))
  })
})
