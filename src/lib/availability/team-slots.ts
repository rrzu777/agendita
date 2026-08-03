import type { ServiceModality } from '@prisma/client'
import { prisma } from '@/lib/db'
import { generateSlots, type GenerateSlotsOptions, type TimeSlot } from '@/lib/availability/slots'
import { getBusinessDayRange } from '@/lib/availability/timezone'
import { getEffectiveBlocks } from '@/lib/availability/effective-blocks'
import {
  blockAppliesToProfessional,
  bookingBlocksProfessional,
  bookingsOfDayWhere,
  rulesForProfessional,
} from '@/lib/availability/scope'
import { resolveBookingModality } from '@/lib/services/modality'
import {
  eligibleProfessionals,
  funnelProfessionalsQueryFor,
  professionalChoice,
  toFunnelProfessionals,
} from '@/lib/professionals/eligible'

/**
 * Los horarios de "Cualquiera disponible": la **unión** de los del equipo que puede
 * tomar esta reserva, deduplicada por instante de inicio. Dos personas libres a las
 * 15:00 son un solo horario en pantalla, no dos.
 *
 * **La unión no cae en una grilla regular.** `generateSlots` re-ancla la grilla en cada
 * obstáculo, así que cada persona arranca sus slots en el borde de SUS propias citas y
 * la lista mezclada puede tener horarios en minutos "raros". Es correcto, pero obliga a
 * ordenarla explícitamente al final: el orden de recorrida del equipo no es el orden de
 * las horas.
 *
 * **Una query por concepto y no una por persona.** Las tres lecturas se piden enteras
 * —todo el horario del negocio, los bloqueos de cualquiera, las reservas del día— y el
 * alcance de cada persona se arma en memoria con los mismos helpers que usan las
 * queries por persona (`rulesForProfessional`, `blockAppliesToProfessional`,
 * `bookingBlocksProfessional`, cada uno pegado a su gemelo de Prisma en `scope.ts`).
 * Con un equipo de cinco, hacerlo persona por persona eran ~25 consultas en la lectura
 * más caliente del producto: una clienta explorando fechas hace un request por click.
 *
 * **Quién es elegible lo decide `professionalChoice`, la misma función que arma la
 * lista en el navegador** — no una copia del filtro escrita para el servidor. Eso es lo
 * que garantiza que la unión que se ofrece acá y los horarios que se ven al elegir a
 * una persona en particular sean la misma cuenta; si divergieran, elegir a Juan después
 * de ver "15:00 con cualquiera" haría desaparecer las 15:00 sin explicación.
 *
 * **Deuda anotada a propósito:** esto y la rama por persona de `_getAvailableTimeSlots`
 * son el mismo cálculo con el alcance armado en distinto lado —acá en memoria, allá en
 * el `where`—, y el precio es que un cambio en cómo se acota (un tipo de obstáculo
 * nuevo, un estado más que ocupe cupo) hay que hacerlo en dos lugares. Lo que hoy los
 * ata es `tests/integration/cualquiera-disponible.test.ts`, que exige que la unión sea
 * exactamente la unión. No se unificaron acá porque el camino batcheado le haría traer
 * a TODOS los negocios —incluidos los miles que no tienen equipo— el horario, los
 * bloqueos y las citas del día entero para recortarlos en memoria: es un cambio en la
 * lectura más caliente del producto para todo el mundo, por una función que sólo usan
 * los negocios con equipo. Merece su propio PR y su propia medición.
 */
export async function getTeamAvailableSlots({
  businessId,
  service,
  date,
  requestedModality,
  timezone,
  slotOptions,
}: {
  businessId: string
  service: { id: string; durationMinutes: number; modalities: ServiceModality[] }
  date: Date
  /** La que eligió la clienta. Se re-deriva contra las del servicio, igual que al escribir. */
  requestedModality: ServiceModality | null | undefined
  timezone: string
  slotOptions: GenerateSlotsOptions
}): Promise<TimeSlot[]> {
  // La MISMA resolución que hace `resolveBookingDraft` antes de escribir: con una sola
  // modalidad el servicio la impone y lo que pidió el navegador se ignora. Filtrar por
  // la pedida sería dejar afuera a gente que sí puede atender —o peor, ofrecer los
  // horarios de quien no viaja a domicilio para una reserva que va a decir domicilio.
  const modality = resolveBookingModality(service.modalities, requestedModality)
  const { dayStart, dayEnd } = getBusinessDayRange(date, timezone)

  const [equipo, reglas, bloqueos, reservas] = await Promise.all([
    // La MISMA query que sirve la pantalla de reservar, no una parecida: las dos
    // tienen que devolver el mismo equipo (ver `funnelProfessionalsQuery`).
    prisma.professional.findMany(funnelProfessionalsQueryFor(businessId)),
    // Sin `isActive` y sin filtrar por persona: la herencia se decide por la
    // EXISTENCIA de filas propias (ver `rulesForProfessional`), así que filtrar acá
    // dejaría a alguien con la semana cerrada heredando el horario del salón.
    prisma.availabilityRule.findMany({
      where: { businessId },
      select: { professionalId: true, dayOfWeek: true, startTime: true, endTime: true, isActive: true },
    }),
    // `everyone` y no el alcance de cada una: los bloqueos del negocio más los de
    // cualquier persona, repartidos después con `blockAppliesToProfessional`.
    getEffectiveBlocks({ businessId, rangeStart: dayStart, rangeEnd: dayEnd, timezone, scope: { kind: 'everyone' } }),
    // Con `select` y no la fila entera: ésta es la única de las tres consultas que va
    // sin acotar a una persona —trae el día de todo el negocio— y es la lectura más
    // caliente del producto. Son las columnas que miran `occupiesSlot` y
    // `bookingBlocksProfessional`, ni una más.
    prisma.booking.findMany({
      where: bookingsOfDayWhere(businessId, dayStart, dayEnd),
      select: {
        professionalId: true, startDateTime: true, endDateTime: true,
        status: true, holdExpiresAt: true, paymentStatus: true, paymentMethod: true,
      },
      orderBy: { startDateTime: 'asc' },
    }),
  ])

  const personas = eligibleProfessionals(
    professionalChoice(toFunnelProfessionals(equipo), service.id, modality),
  )

  // El Map deduplica por instante de inicio. El fin no entra en la clave porque es
  // siempre inicio + duración del servicio: dos personas libres a la misma hora
  // producen slots idénticos.
  const porInstante = new Map<number, TimeSlot>()
  for (const persona of personas) {
    const slots = generateSlots(
      date,
      service.durationMinutes,
      rulesForProfessional(reglas, persona.id),
      bloqueos.filter((b) => blockAppliesToProfessional(b, persona.id)),
      reservas.filter((b) => bookingBlocksProfessional(b, persona.id)),
      slotOptions,
    )
    for (const slot of slots) porInstante.set(slot.start.getTime(), slot)
  }

  return [...porInstante.values()].sort((a, b) => a.start.getTime() - b.start.getTime())
}
