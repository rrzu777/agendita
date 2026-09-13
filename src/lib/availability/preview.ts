import { z } from 'zod'
import { addDays } from 'date-fns'
import { prisma } from '@/lib/db'
import { UserError } from '@/lib/actions/result'
import { normalizeServiceSelection, resolveSelectedServices } from '@/lib/bookings/selection'
import { resolveBookingModality } from '@/lib/services/modality'
import { funnelProfessionalsQueryFor, professionalChoiceForServices, toFunnelProfessionals, eligibleProfessionals } from '@/lib/professionals/eligible'
import type { AvailableSlotsInput } from '@/server/actions/availability'
import { generateSlotsResult, type TimeSlot } from './slots'
import { getLocalDateStr, startOfLocalDay, endOfLocalDay, localDateTimeToUtc } from './timezone'
import { getEffectiveBlocks } from './effective-blocks'
import { bookingsOfDayWhere, rulesForProfessional, bookingBlocksProfessional, blockAppliesToProfessional } from './scope'

export type AvailabilityPreviewInput = Omit<AvailableSlotsInput, 'date'> & { from: string; days: number }
const schema = z.object({
  businessId: z.string().min(1).max(128),
  from: z.string().regex(/^20\d\d-\d\d-\d\d$/).refine(s => Number.isFinite(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s),
  days: z.number().int().min(1).max(31),
  modality: z.enum(['on_site', 'at_home', 'online']).nullish(),
  professional: z.discriminatedUnion('kind', [z.object({ kind: z.literal('none') }), z.object({ kind: z.literal('anyone') }), z.object({ kind: z.literal('person'), id: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/) })]),
})
function calendarDay(from: string, offset: number) {
  const date = new Date(`${from}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() + offset)
  return date.toISOString().slice(0, 10)
}

/** Bounded range, one read per concept, never one query per day/professional.
 * Returns only aggregate capacity and public professional IDs, never busy rows. */
export async function computeAvailabilityPreview(input: AvailabilityPreviewInput) {
  const parsed = schema.safeParse(input)
  if (!parsed.success) throw new UserError('La consulta de disponibilidad no es válida')
  const { businessId, from, days, professional } = parsed.data
  const ids = normalizeServiceSelection(input)
  const [business, services, team] = await Promise.all([
    prisma.business.findUnique({ where: { id: businessId, isActive: true }, select: { timezone: true, bookingWindowDays: true, slotStepMinutes: true } }),
    prisma.service.findMany({ where: { businessId, id: { in: ids }, isActive: true } }),
    prisma.professional.findMany({ ...funnelProfessionalsQueryFor(businessId), take: 101 }),
  ])
  if (!business) throw new UserError('Negocio no disponible')
  if (team.length > 100) throw new UserError('No pudimos resumir esta agenda. Intenta nuevamente.')
  const selection = resolveSelectedServices(businessId, ids, services)
  const modality = resolveBookingModality(selection.modalities, parsed.data.modality)
  const choice = professionalChoiceForServices(toFunnelProfessionals(team), ids, modality)
  if (choice.kind === 'unavailable') throw new UserError('No hay un profesional que realice todos estos servicios. Cambia la selección.')
  const eligible = eligibleProfessionals(choice)
  if (professional.kind === 'person' && !eligible.some(p => p.id === professional.id)) throw new UserError('Ese profesional no está disponible para estos servicios')
  if (professional.kind === 'none' && team.length) throw new UserError('Elige un profesional o Cualquiera disponible')
  if (professional.kind === 'anyone' && !eligible.length) throw new UserError('No hay profesionales disponibles')
  const timezone = business.timezone || 'America/Santiago'
  const now = new Date()
  const today = getLocalDateStr(now, timezone)
  const windowEnd = getLocalDateStr(addDays(now, business.bookingWindowDays ?? 90), timezone)
  const dates = Array.from({ length: days }, (_, i) => calendarDay(from, i))
  const inWindow = dates.filter(d => d >= today && d <= windowEnd)
  const nextByProfessional = new Map<string, TimeSlot>()
  const emptyDays = dates.map(date => ({ date, count: 0, firstSlot: null as TimeSlot | null }))
  if (!inWindow.length) return { days: emptyDays, professionals: eligible.map(p => ({ id: p.id, firstSlot: null as TimeSlot | null })), today, windowEnd }
  const rangeStart = startOfLocalDay(inWindow[0], timezone)
  const rangeEnd = endOfLocalDay(inWindow[inWindow.length - 1], timezone)
  const [rules, blocks, bookings] = await Promise.all([
    prisma.availabilityRule.findMany({ where: { businessId }, take: 1001 }),
    getEffectiveBlocks({ businessId, rangeStart, rangeEnd, timezone, scope: professional.kind === 'person' ? { kind: 'professional', professionalId: professional.id } : professional.kind === 'none' ? { kind: 'business' } : { kind: 'everyone' }, limits: { oneOff: 1000, series: 100, exceptionsPerSeries: 62, expanded: 10000 } }),
    prisma.booking.findMany({ where: bookingsOfDayWhere(businessId, rangeStart, rangeEnd), take: 10001, select: { professionalId: true, startDateTime: true, endDateTime: true, status: true, holdExpiresAt: true, paymentStatus: true, paymentMethod: true } }),
  ])
  if (rules.length > 1000 || bookings.length > 10000 || blocks.length > 10000) throw new UserError('La agenda es demasiado grande para este resumen. Consulta un período más corto.')
  const people: (string | null)[] = professional.kind === 'person' ? [professional.id] : eligible.length ? eligible.map(p => p.id) : [null]
  const resultDays = emptyDays.map(day => {
    if (day.date < today || day.date > windowEnd) return day
    const union = new Map<number, TimeSlot>()
    for (const id of people) {
      const slots = generateSlotsResult(localDateTimeToUtc(day.date, '12:00', timezone), selection.durationMinutes,
        id ? rulesForProfessional(rules, id) : rules.filter(r => !r.professionalId && r.isActive),
        blocks.filter(b => id ? blockAppliesToProfessional(b, id) : !b.professionalId),
        bookings.filter(b => bookingBlocksProfessional(b, id)),
        { timezone, now, bookingWindowDays: business.bookingWindowDays ?? 90, slotStepMinutes: business.slotStepMinutes },
      ).slots
      if (id && slots[0] && !nextByProfessional.has(id)) nextByProfessional.set(id, slots[0])
      if (professional.kind !== 'person' || professional.id === id) for (const slot of slots) union.set(slot.start.getTime(), slot)
    }
    const slots = [...union.values()].sort((a, b) => a.start.getTime() - b.start.getTime())
    return { date: day.date, count: slots.length, firstSlot: slots[0] ?? null }
  })
  return { days: resultDays, professionals: eligible.map(p => ({ id: p.id, firstSlot: nextByProfessional.get(p.id) ?? null })), today, windowEnd }
}
