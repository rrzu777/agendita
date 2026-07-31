'use server'

import { z } from 'zod'
import { prisma } from '@/lib/db'
import { revalidatePath } from 'next/cache'
import { checkRateLimit } from '@/lib/rate-limit'
import { revalidateBusinessPublicPaths } from './revalidate-business'
import { generateSlots } from '@/lib/availability/slots'
import { getBusinessDayRange } from '@/lib/availability/timezone'
import { getEffectiveBlocks } from '@/lib/availability/effective-blocks'
import { requireBusiness, requireBusinessRole, ForbiddenError } from '@/lib/auth/server'
import { isValidTimeRange } from '@/lib/availability/time-range'
import { computeRescheduleSlots } from '@/lib/availability/reschedule-slots'
import { blockScopeFor, bookingScopeCondition, businessScheduleWhere, normalizeProfessionalId, resolveAvailabilityRules, resolveRuleScope } from '@/lib/availability/scope'
import { materializeProfessionalSchedule, projectWeek, scheduleLockKey } from '@/lib/availability/weekly-schedule'
import { acquireAdvisoryXactLock } from '@/lib/db/advisory-lock'
import { assertProfessionalOfBusiness, isProfessionalOfBusiness } from '@/lib/professionals/ownership'
import { RELEASED_STATUSES } from '@/lib/bookings/approval'
import { action, UserError } from '@/lib/actions/result'

const timeRegex = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/

// La base de los DOS editores de horario, el del salón y el por persona. Separadas,
// cambiar el regex o agregar una duración mínima en una deja a la otra aceptando lo
// que la primera rechaza — y las dos pantallas se ven iguales, así que la asimetría
// aparece recién en producción. El `.refine` va en cada una porque devuelve un
// `ZodEffects` y `.extend` sólo existe en el objeto pelado.
const weekdayHoursShape = z.object({
  startTime: z.string().regex(timeRegex, 'Formato de hora inválido (HH:MM)'),
  endTime: z.string().regex(timeRegex, 'Formato de hora inválido (HH:MM)'),
  isActive: z.boolean(),
})

const validRange = {
  check: (d: { startTime: string; endTime: string }) => isValidTimeRange(d.startTime, d.endTime),
  message: 'La hora de inicio debe ser anterior a la de término',
}

const updateAvailabilityRuleSchema = weekdayHoursShape.refine(validRange.check, {
  message: validRange.message,
})

// Por día y no por id de regla: cuando una persona hereda, no tiene ninguna fila
// propia todavía, así que no hay id que mandar. Ver `projectWeek`.
const professionalRuleSchema = weekdayHoursShape
  .extend({ dayOfWeek: z.number().int().min(0).max(6) })
  .refine(validRange.check, { message: validRange.message })

const rescheduleSlotsSchema = z.object({
  bookingId: z.string().min(1),
  date: z.date(),
})

const NON_RESCHEDULABLE_STATUSES = ['completed', 'cancelled', 'no_show', 'expired'] as const

// El horario del negocio, para el editor semanal: `professionalId: null` explícito
// aunque hoy no haya otras filas. Sin el filtro, el día que existan reglas por
// persona esta pantalla mostraría 14 filas mezcladas sin decir de quién es cada
// una — y el editor guarda por id, así que la dueña editaría el horario de
// cualquiera creyendo que edita el del salón.
export async function getAvailabilityRules() {
  const { businessId } = await requireBusiness()
  return prisma.availabilityRule.findMany({
    where: businessScheduleWhere(businessId),
    orderBy: { dayOfWeek: 'asc' },
  })
}

// `professionalId` es obligatorio y no opcional con default: un `undefined` que
// llegue hasta un `where` de Prisma no filtra, matchea todo, y acá eso significa
// mezclar el horario y los bloqueos de todo el equipo en un solo cálculo. El
// resultado es "los horarios no funcionan" sin un error en ningún log. Que el
// compilador obligue a decidir en cada caller.
async function _getAvailableTimeSlots(
  businessId: string,
  serviceId: string,
  date: Date,
  professionalIdInput: string | null,
) {
  // Esta action es PÚBLICA: el cuarto argumento llega del navegador. Se normaliza una
  // sola vez acá —el borde— y abajo se usa siempre el valor normalizado.
  const professionalId = normalizeProfessionalId(professionalIdInput)
  // Config 'get-availability' (60/min por IP): una clienta explorando fechas
  // hace un request por click; 10/min se agotaba en uso humano normal.
  const limit = await checkRateLimit('get-availability')
  if (!limit.success) {
    throw new UserError('Demasiadas solicitudes. Intenta de nuevo en unos minutos.')
  }

  const business = await prisma.business.findUnique({
    where: { id: businessId, isActive: true },
    select: { id: true, timezone: true, bookingWindowDays: true, slotStepMinutes: true },
  })
  if (!business) {
    throw new UserError('Negocio no válido')
  }

  // Normalizar defiende la FORMA; esto defiende la PROCEDENCIA. Un id que no es de
  // este negocio, o de alguien que ya no atiende, caería por herencia al horario del
  // salón y devolvería slots como si todo estuviera bien: el problema se descubriría
  // recién cuando la reserva se crea a nombre de nadie.
  if (professionalId !== null && !(await isProfessionalOfBusiness(prisma, businessId, professionalId))) {
    throw new UserError('Esa persona no está disponible para reservar')
  }

  const timezone = business.timezone || 'America/Santiago'
  const bookingWindowDays = business.bookingWindowDays ?? 90
  const { dayStart, dayEnd } = getBusinessDayRange(date, timezone)

  const [service, availabilityRules, timeBlocks, bookings] = await Promise.all([
    prisma.service.findFirst({
      where: { id: serviceId, businessId, isActive: true },
      select: { durationMinutes: true },
    }),
    resolveAvailabilityRules(prisma, businessId, professionalId),
    getEffectiveBlocks({
      businessId,
      rangeStart: dayStart,
      rangeEnd: dayEnd,
      timezone,
      scope: blockScopeFor(professionalId),
    }),
    prisma.booking.findMany({
      where: {
        businessId,
        status: { notIn: [...RELEASED_STATUSES] },
        startDateTime: { lte: dayEnd },
        endDateTime: { gte: dayStart },
        AND: bookingScopeCondition(professionalId),
      },
      orderBy: { startDateTime: 'asc' },
    }),
  ])

  if (!service) {
    throw new UserError('Servicio no disponible')
  }

  return generateSlots(date, service.durationMinutes, availabilityRules, timeBlocks, bookings, {
    timezone,
    now: new Date(),
    bookingWindowDays,
    slotStepMinutes: business.slotStepMinutes,
  })
}

export const getAvailableTimeSlots = action(_getAvailableTimeSlots)

async function _getAvailableSlotsForReschedule(bookingId: string, date: Date) {
  const { businessId } = await requireBusinessRole(['owner', 'admin'])

  const parsed = rescheduleSlotsSchema.safeParse({ bookingId, date })
  if (!parsed.success) {
    throw new UserError('Datos inválidos: ' + parsed.error.issues.map(i => i.message).join(', '))
  }

  const booking = await prisma.booking.findFirst({
    where: { id: bookingId, businessId },
    include: {
      service: { select: { id: true, durationMinutes: true, name: true, isActive: true } },
      business: { select: { timezone: true, bookingWindowDays: true, slotStepMinutes: true } },
    },
  })

  if (!booking) {
    throw new ForbiddenError('Reserva no encontrada')
  }

  if (NON_RESCHEDULABLE_STATUSES.includes(booking.status as typeof NON_RESCHEDULABLE_STATUSES[number])) {
    throw new UserError('No se puede reprogramar una reserva en este estado')
  }

  if (!booking.service || !booking.service.isActive) {
    throw new UserError('Servicio no disponible')
  }

  return computeRescheduleSlots(booking, date)
}

export const getAvailableSlotsForReschedule = action(_getAvailableSlotsForReschedule)

async function _updateAvailabilityRule(
  id: string,
  data: { startTime: string; endTime: string; isActive: boolean }
) {
  const { businessId } = await requireBusinessRole(['owner', 'admin'])
  const limit = await checkRateLimit('update-availability')
  if (!limit.success) {
    throw new UserError('Demasiadas solicitudes. Intenta de nuevo en unos minutos.')
  }

  const parsed = updateAvailabilityRuleSchema.safeParse(data)
  if (!parsed.success) {
    throw new UserError('Datos inválidos: ' + parsed.error.issues.map(i => i.message).join(', '))
  }

  // `professionalId: null` en el WHERE del write, no sólo en la lectura: esta action
  // edita el horario DEL SALÓN. Sin esto, la única defensa contra editar el horario
  // de una persona desde acá es que la pantalla no reciba esos ids — o sea una
  // coincidencia de la capa de presentación, no una garantía. El editor por persona
  // del PR siguiente necesita decir explícitamente de quién es la regla que toca.
  const updateResult = await prisma.availabilityRule.updateMany({
    where: { id, businessId, professionalId: null },
    data,
  })
  if (updateResult.count === 0) {
    throw new ForbiddenError('Regla no encontrada')
  }

  const updated = await prisma.availabilityRule.findUnique({ where: { id } })
  revalidatePath('/dashboard/availability')
  if (updated) {
    await revalidateBusinessPublicPaths(updated.businessId)
  }
  return updated
}

export const updateAvailabilityRule = action(_updateAvailabilityRule)

/**
 * El horario que rige a una persona, para el editor. `inherited` dice **de dónde
 * salió**: sin filas propias, lo que se devuelve es el horario del salón, y esa
 * distinción es la única forma de que la pantalla no diga "este es el horario de Ana"
 * cuando en realidad es el del salón que Ana todavía no cambió.
 */
async function _getProfessionalSchedule(professionalId: string) {
  const { businessId } = await requireBusinessRole(['owner', 'admin'])
  const id = await assertProfessionalOfBusiness(prisma, businessId, professionalId)

  // La herencia se pregunta donde vive y no se rearma acá: `resolveRuleScope` devuelve
  // de quién son las reglas que rigen, y es el MISMO helper que usa el funnel. Con un
  // `own.length > 0` propio, el día que la regla cambie esta pantalla diría "horario
  // propio" mientras los slots se calculan con el del salón, sin error en ningún lado.
  const scope = await resolveRuleScope(prisma, businessId, id)
  const rules = await prisma.availabilityRule.findMany({
    where: { businessId, professionalId: scope },
    // Sin `id` en el select: cuando hereda, estas filas son las DEL SALÓN. `projectWeek`
    // igual los descartaría, pero que no salgan de la base es una defensa más.
    select: { dayOfWeek: true, startTime: true, endTime: true, isActive: true },
  })
  return { inherited: scope === null, days: projectWeek(rules) }
}

export const getProfessionalSchedule = action(_getProfessionalSchedule)

/**
 * Cambia UN día del horario de una persona. Si todavía heredaba, en la misma
 * transacción se le copia la semana entera y recién después se aplica el cambio —
 * ver `materializeProfessionalSchedule`: copiar sólo el día editado la deja cerrada
 * el resto de la semana.
 */
async function _updateProfessionalAvailabilityRule(
  professionalId: string,
  data: { dayOfWeek: number; startTime: string; endTime: string; isActive: boolean },
) {
  const { businessId } = await requireBusinessRole(['owner', 'admin'])
  const limit = await checkRateLimit('update-availability')
  if (!limit.success) {
    throw new UserError('Demasiadas solicitudes. Intenta de nuevo en unos minutos.')
  }

  const parsed = professionalRuleSchema.safeParse(data)
  if (!parsed.success) {
    throw new UserError('Datos inválidos: ' + parsed.error.issues.map(i => i.message).join(', '))
  }
  const { dayOfWeek, startTime, endTime, isActive } = parsed.data

  // Devuelve el id NORMALIZADO y de ahí en adelante se usa ese: el argumento crudo no
  // vuelve a tocarse. Un `undefined` en el `where` del `updateMany` no filtra nada —
  // le cambiaría el día al salón y a todo el equipo.
  const id = await assertProfessionalOfBusiness(prisma, businessId, professionalId)

  await prisma.$transaction(async (tx) => {
    await materializeProfessionalSchedule(tx, businessId, id)
    // `updateMany` y no `update`: la clave es `(negocio, persona, día)` y no hay unique
    // que la respalde, así que no existe un `where` de `update` que la exprese.
    const updated = await tx.availabilityRule.updateMany({
      where: { businessId, professionalId: id, dayOfWeek },
      data: { startTime, endTime, isActive },
    })
    // Después de materializar tiene que haber fila para los 7 días, así que `count: 0`
    // significa que la persona tiene filas propias PARCIALES — hoy ningún camino de la
    // app las crea, pero un backfill o un import sí, y la materialización nunca las
    // completa porque ya cuenta como "tiene horario propio". Sin este guard eso es un
    // `updateMany` que no toca nada y una pantalla que dice "guardado": el peor
    // desenlace posible, porque nadie se entera.
    if (updated.count === 0) {
      throw new UserError('No pudimos guardar ese día. Soltá el horario propio de esta persona y volvé a configurarlo.')
    }
  })

  revalidatePath('/dashboard/availability')
  await revalidateBusinessPublicPaths(businessId)
}

export const updateProfessionalAvailabilityRule = action(_updateProfessionalAvailabilityRule)

/**
 * Le saca el horario propio a una persona: vuelve a seguir el del salón, y a seguirlo
 * **hacia adelante** — es la razón de ser de la herencia (ver `resolveRuleScope`).
 */
async function _resetProfessionalSchedule(professionalId: string) {
  const { businessId } = await requireBusinessRole(['owner', 'admin'])
  const limit = await checkRateLimit('update-availability')
  if (!limit.success) {
    throw new UserError('Demasiadas solicitudes. Intenta de nuevo en unos minutos.')
  }

  const id = await assertProfessionalOfBusiness(prisma, businessId, professionalId)

  // Mismo lock que la materialización, y no por simetría: sin él, un reset en una
  // pestaña que caiga entre el `count` y el `createMany` de un guardado en otra queda
  // DESHECHO en silencio — la persona sigue con horario propio y la dueña ve que el
  // botón "no hizo nada". El lock protege el recurso `(negocio, persona)`, no una
  // función, así que las dos escrituras tienen que tomarlo.
  await prisma.$transaction(async (tx) => {
    await acquireAdvisoryXactLock(tx, scheduleLockKey(businessId, id))
    // `professionalId` en el where es lo único que separa esto de borrar el horario del
    // salón: sin él, un `deleteMany` por `businessId` deja al negocio sin ningún día de
    // atención y sin forma de recuperarlo desde la pantalla.
    await tx.availabilityRule.deleteMany({ where: { businessId, professionalId: id } })
  })

  revalidatePath('/dashboard/availability')
  await revalidateBusinessPublicPaths(businessId)
}

export const resetProfessionalSchedule = action(_resetProfessionalSchedule)
