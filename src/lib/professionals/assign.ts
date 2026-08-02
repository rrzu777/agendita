import type { ServiceModality } from '@prisma/client'
import { assertSlotIsAvailable, SLOT_UNAVAILABLE_MESSAGE, type AssertSlotInput } from '@/lib/availability/validation'
import { getBusinessDayRange } from '@/lib/availability/timezone'
import { RELEASED_STATUSES } from '@/lib/bookings/approval'
import { professionalEligibilityWhere, type ProfessionalPick } from '@/lib/professionals/eligible'
import { UserError } from '@/lib/actions/result'

/**
 * Cuando la clienta pidió "cualquiera" y ya no queda nadie que haga ese servicio. Es
 * distinto de que la hora esté tomada —ahí sirve elegir otra— y por eso no comparte el
 * mensaje: acá ninguna hora va a funcionar hasta que la dueña vuelva a asignar el
 * servicio a alguien.
 */
export const NO_ONE_AVAILABLE_MESSAGE = 'Ya no hay nadie que pueda tomar esta reserva'

/**
 * A quién le toca, en el orden en que conviene probarlo: **primero quien menos citas
 * tiene ese día**, y a igual carga manda el `sortOrder` que definió la dueña.
 *
 * Repartir por carga y no por orden fijo es lo que evita que el primero de la lista se
 * lleve todo el día mientras el resto mira. El desempate por `sortOrder` es estable
 * porque `Array.prototype.sort` lo es: la query ya viene ordenada por `(sortOrder, id)`
 * y las cargas iguales conservan ese orden.
 *
 * El conteo mira las citas que solapan el día local del negocio —el mismo rango y los
 * mismos estados que usa el cálculo de horarios—, no las creadas ese día.
 */
async function candidatesByLoad(
  tx: AssertSlotInput['tx'],
  args: { businessId: string; serviceId: string; modality: ServiceModality; startDateTime: Date; timezone: string },
): Promise<string[]> {
  const elegibles = await tx.professional.findMany({
    where: {
      businessId: args.businessId,
      isActive: true,
      ...professionalEligibilityWhere(args.serviceId, args.modality),
    },
    select: { id: true },
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
  })
  if (elegibles.length <= 1) return elegibles.map((p) => p.id)

  const { dayStart, dayEnd } = getBusinessDayRange(args.startDateTime, args.timezone)
  const cargas = await tx.booking.groupBy({
    by: ['professionalId'],
    where: {
      businessId: args.businessId,
      professionalId: { in: elegibles.map((p) => p.id) },
      status: { notIn: [...RELEASED_STATUSES] },
      startDateTime: { lte: dayEnd },
      endDateTime: { gte: dayStart },
    },
    _count: { _all: true },
  })
  const carga = new Map(cargas.map((c) => [c.professionalId, c._count._all]))

  return elegibles
    .map((p) => p.id)
    .sort((a, b) => (carga.get(a) ?? 0) - (carga.get(b) ?? 0))
}

/**
 * Valida el horario y devuelve **a nombre de quién queda la reserva**. Es el único
 * lugar donde se resuelve "Cualquiera disponible", y corre adentro de la transacción,
 * después del advisory lock que toma `assertSlotIsAvailable`.
 *
 * Que se resuelva acá y no en el navegador es la razón de ser de la función: entre que
 * la clienta ve "15:00 con cualquiera" y aprieta pagar, la persona que estaba libre
 * puede haber tomado otra cita. Resolver antes del lock es la misma carrera, sólo que
 * más corta.
 *
 * **Probar candidatos con el assert de verdad, y no con una copia liviana del chequeo,
 * es lo que garantiza que no se pueda asignar a alguien que después rebota.** El precio
 * es una pasada de consultas por candidato descartado; el orden por carga hace que en
 * el caso normal la primera ya sirva.
 *
 * Atajar el `UserError` adentro de la transacción **sí** es seguro, a diferencia del
 * P2002 que documenta `p2002-inside-tx-cannot-be-caught`: eso es un error de Postgres y
 * aborta la transacción entera, esto lo tira nuestro código después de que todas las
 * consultas salieron bien. Cualquier otro error se re-lanza.
 */
export async function assertSlotAndResolveProfessional(
  input: Omit<AssertSlotInput, 'professionalId'> & {
    professional: ProfessionalPick
    /** La modalidad RESUELTA por `resolveBookingDraft`, no la que pidió el navegador. */
    modality: ServiceModality
  },
): Promise<string | null> {
  const { professional, modality, ...slot } = input

  if (professional.kind !== 'anyone') {
    const professionalId = professional.kind === 'person' ? professional.id : null
    await assertSlotIsAvailable({ ...slot, professionalId })
    return professionalId
  }

  const candidatos = await candidatesByLoad(slot.tx, {
    businessId: slot.businessId,
    serviceId: slot.serviceId,
    modality,
    startDateTime: slot.startDateTime,
    timezone: slot.timezone,
  })
  if (candidatos.length === 0) throw new UserError(NO_ONE_AVAILABLE_MESSAGE)

  for (const professionalId of candidatos) {
    try {
      await assertSlotIsAvailable({ ...slot, professionalId })
      return professionalId
    } catch (error) {
      if (error instanceof UserError) continue
      throw error
    }
  }

  // Nadie libre: para la clienta es exactamente lo mismo que si hubiera elegido a una
  // persona ocupada, y la salida es la misma —elegir otra hora—, así que comparte el
  // mensaje en vez de inventar uno que la haga pensar que el problema es otro.
  throw new UserError(SLOT_UNAVAILABLE_MESSAGE)
}
