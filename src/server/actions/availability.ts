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
import { blockScopeFor, bookingScopeCondition, normalizeProfessionalId, resolveAvailabilityRules, resolveRuleScope } from '@/lib/availability/scope'
import { readWeek, scheduleLockKey, setWeekday } from '@/lib/availability/weekly-schedule'
import { acquireAdvisoryXactLock } from '@/lib/db/advisory-lock'
import { assertOwnerScope, assertProfessionalOfBusiness, isProfessionalOfBusiness, PROFESSIONAL_UNAVAILABLE_MESSAGE } from '@/lib/professionals/ownership'
import { RELEASED_STATUSES } from '@/lib/bookings/approval'
import { action, UserError } from '@/lib/actions/result'

const timeRegex = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/

// Por día y no por id de regla, y vale para los dos alcances. Dos razones y las dos
// son de fondo: cuando una persona hereda no tiene ninguna fila propia todavía, así que
// no hay id que mandar (ver `projectWeek`); y el salón se siembra sin domingo, así que
// tampoco había id para el día que quería abrir. `(negocio, alcance, día)` es la
// identidad real de un día de horario.
const weekdayScheduleSchema = z
  .object({
    dayOfWeek: z.number().int().min(0).max(6),
    startTime: z.string().regex(timeRegex, 'Formato de hora inválido (HH:MM)'),
    endTime: z.string().regex(timeRegex, 'Formato de hora inválido (HH:MM)'),
    isActive: z.boolean(),
  })
  .refine((d) => isValidTimeRange(d.startTime, d.endTime), {
    message: 'La hora de inicio debe ser anterior a la de término',
  })

const rescheduleSlotsSchema = z.object({
  bookingId: z.string().min(1),
  date: z.date(),
})

const NON_RESCHEDULABLE_STATUSES = ['completed', 'cancelled', 'no_show', 'expired'] as const

/**
 * El horario semanal de un alcance, para el editor: `null` es el salón, un id es esa
 * persona. Siempre 7 días, de domingo a sábado (ver `projectWeek`).
 *
 * `inherited` dice **de dónde salió** lo que se devuelve: una persona sin filas propias
 * está viendo el horario DEL SALÓN, y esa distinción es la única forma de que la
 * pantalla no diga "este es el horario de Ana" cuando todavía no lo es. Para el salón
 * es siempre `false` — el salón no hereda de nadie.
 */
export async function getWeeklySchedule(professionalId: string | null) {
  // `requireBusiness` y no `requireBusinessRole`: es el mismo permiso que tenía la
  // lectura del horario del salón antes de este PR. Alguien con rol `staff` ve la
  // pantalla en modo consulta —cada guardado sí exige owner/admin— y subirle el listón
  // a la lectura le rompería la página con un error en vez de mostrarla.
  const { businessId } = await requireBusiness()
  const owner = await assertOwnerScope(prisma, businessId, professionalId)

  // La herencia se pregunta donde vive y no se rearma acá: `resolveRuleScope` devuelve
  // de quién son las reglas que rigen, y es el MISMO helper que usa el funnel. Con un
  // `own.length > 0` propio, el día que la regla cambie esta pantalla diría "horario
  // propio" mientras los slots se calculan con el del salón, sin error en ningún lado.
  const scope = owner === null ? null : await resolveRuleScope(prisma, businessId, owner)

  return {
    inherited: owner !== null && scope === null,
    days: await readWeek(prisma, businessId, scope),
  }
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

  const timezone = business.timezone || 'America/Santiago'
  const bookingWindowDays = business.bookingWindowDays ?? 90
  const { dayStart, dayEnd } = getBusinessDayRange(date, timezone)

  // El chequeo de procedencia va ADENTRO del Promise.all y no antes: no depende de
  // nada de lo que se pide acá, y en serie le sumaba un round trip a la lectura más
  // caliente del producto —una clienta explorando fechas hace un request por click—.
  // Que las otras cuatro consultas corran con un id inválido no ensucia nada: el
  // throw de abajo pasa antes de que ningún resultado se use.
  const [profValido, service, availabilityRules, timeBlocks, bookings] = await Promise.all([
    professionalId === null || isProfessionalOfBusiness(prisma, businessId, professionalId),
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

  // Normalizar defiende la FORMA; esto defiende la PROCEDENCIA. Un id que no es de
  // este negocio, o de alguien que ya no atiende, cae por herencia al horario del
  // salón y devuelve slots como si todo estuviera bien: el problema se descubriría
  // recién cuando la reserva se crea a nombre de nadie.
  if (!profValido) {
    throw new UserError(PROFESSIONAL_UNAVAILABLE_MESSAGE)
  }

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

/**
 * Guarda UN día del horario de un alcance: `null` es el salón, un id es esa persona.
 *
 * Una sola escritura para los dos editores. Cuando eran dos —el salón por id de regla,
 * la persona por `(persona, día)`— el salón no podía abrir un día que no tenía fila; ver
 * `setWeekday`, que es donde está el porqué completo.
 *
 * Si la persona todavía heredaba, en la misma transacción se le copia la semana entera
 * y recién después se aplica el cambio: copiar sólo el día editado la deja cerrada el
 * resto de la semana.
 */
async function _setWeeklyScheduleDay(
  professionalId: string | null,
  data: { dayOfWeek: number; startTime: string; endTime: string; isActive: boolean },
) {
  const { businessId } = await requireBusinessRole(['owner', 'admin'])
  const limit = await checkRateLimit('update-availability')
  if (!limit.success) {
    throw new UserError('Demasiadas solicitudes. Intenta de nuevo en unos minutos.')
  }

  const parsed = weekdayScheduleSchema.safeParse(data)
  if (!parsed.success) {
    throw new UserError('Datos inválidos: ' + parsed.error.issues.map(i => i.message).join(', '))
  }

  // Devuelve el alcance NORMALIZADO y de ahí en adelante se usa ese: el argumento crudo
  // no vuelve a tocarse. Un `undefined` en el `where` del `updateMany` no filtra nada —
  // le cambiaría el día al salón y a todo el equipo de una.
  const owner = await assertOwnerScope(prisma, businessId, professionalId)

  await prisma.$transaction((tx) => setWeekday(tx, businessId, owner, parsed.data))

  revalidatePath('/dashboard/availability')
  await revalidateBusinessPublicPaths(businessId)
}

export const setWeeklyScheduleDay = action(_setWeeklyScheduleDay)

/**
 * Le saca el horario propio a una persona: vuelve a seguir el del salón, y a seguirlo
 * **hacia adelante** — es la razón de ser de la herencia (ver `resolveRuleScope`).
 *
 * Devuelve el horario que queda rigiendo, que es el del salón. La pantalla lo necesita:
 * las horas que tenía en la mano son las que se acaban de borrar, y sin esto quedaría
 * mostrando un horario que ya no existe en ningún lado.
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

  // La MISMA lectura que usa la pantalla al cargar (`getWeeklySchedule`), no una copia:
  // las dos terminan en el mismo `useState` del editor, así que dos lecturas distintas
  // significan que la pantalla muestra una semana al soltar el horario y otra al
  // recargar, sin un error en ningún lado.
  //
  // Fuera de la transacción a propósito: ya está borrado, y leerlo adentro no lo haría
  // más consistente para quien mira la pantalla — el salón puede cambiar un segundo
  // después igual.
  const days = await readWeek(prisma, businessId, null)

  revalidatePath('/dashboard/availability')
  await revalidateBusinessPublicPaths(businessId)

  return { days }
}

export const resetProfessionalSchedule = action(_resetProfessionalSchedule)
