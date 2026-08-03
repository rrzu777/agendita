import type { ServiceModality } from '@prisma/client'
import {
  assertProfessionalIsFree,
  assertSlotIsBookable,
  SLOT_UNAVAILABLE_MESSAGE,
  type AssertSlotInput,
} from '@/lib/availability/validation'
import { getBusinessDayRange } from '@/lib/availability/timezone'
import { bookingBlocksProfessional, bookingsOfDayWhere } from '@/lib/availability/scope'
import { occupiesSlot, type SlotOccupancyFields } from '@/lib/bookings/approval'
import { professionalEligibilityWhere, type ProfessionalPick } from '@/lib/professionals/eligible'
import { activeProfessionalWhere } from '@/lib/professionals/ownership'
import { UserError } from '@/lib/actions/result'

/**
 * Cuando la clienta pidió "cualquiera" y ya no queda nadie que haga ese servicio. Es
 * distinto de que la hora esté tomada —ahí sirve elegir otra— y por eso no comparte el
 * mensaje: acá ninguna hora va a funcionar hasta que la dueña vuelva a asignar el
 * servicio a alguien.
 */
export const NO_ONE_AVAILABLE_MESSAGE = 'Ya no hay nadie que pueda tomar esta reserva'

type CitaDelDia = SlotOccupancyFields & {
  professionalId: string | null
  startDateTime: Date
  endDateTime: Date
}

/**
 * A quién le toca, **en el orden en que conviene probarlo**. Tres criterios, y el
 * primero es sólo una corazonada:
 *
 * 1. **quien no tenga ya una cita encima de esa hora.** Sale de las citas del día que
 *    igual hay que traer para contar la carga, así que es gratis. NO decide nada: la
 *    lectura va sin `FOR UPDATE` y sin barrer los holds abandonados, así que puede
 *    dar por ocupado a alguien que en realidad está libre. Por eso ordena en vez de
 *    filtrar — quien queda al fondo igual se prueba, y quien decide es el chequeo de
 *    verdad. Sin esto, en una hora peleada el bucle le pregunta a la base por cada
 *    persona ocupada antes de llegar a la que sirve, con el advisory lock puesto;
 * 2. **quien menos citas tenga ese día**, que es lo que evita que el primero de la
 *    lista se lleve el día entero;
 * 3. **el `sortOrder` que definió la dueña**. El desempate es estable porque
 *    `Array.prototype.sort` lo es: la query ya viene ordenada por `(sortOrder, id)` y
 *    las cargas iguales conservan ese orden. El `id` está para que dos personas con el
 *    mismo `sortOrder` no queden en un orden que dependa del plan de Postgres.
 *
 * El día es el día LOCAL del negocio, y los estados que cuentan son los mismos que usa
 * el cálculo de horarios: contar distinto que la pantalla sería repartir por una carga
 * que nadie ve.
 */
async function candidatesByLoad(
  tx: AssertSlotInput['tx'],
  args: {
    businessId: string
    serviceId: string
    modality: ServiceModality
    startDateTime: Date
    endDateTime: Date
    timezone: string
  },
): Promise<string[]> {
  const elegibles = await tx.professional.findMany({
    where: {
      ...activeProfessionalWhere(args.businessId),
      ...professionalEligibilityWhere(args.serviceId, args.modality),
    },
    select: { id: true },
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
  })
  if (elegibles.length <= 1) return elegibles.map((p) => p.id)

  const { dayStart, dayEnd } = getBusinessDayRange(args.startDateTime, args.timezone)
  const citas = (await tx.booking.findMany({
    where: bookingsOfDayWhere(args.businessId, dayStart, dayEnd),
    select: {
      professionalId: true, startDateTime: true, endDateTime: true,
      status: true, holdExpiresAt: true, paymentStatus: true, paymentMethod: true,
    },
  })) as CitaDelDia[]

  const ahora = new Date()
  const ocupan = citas.filter((c) => occupiesSlot(c, ahora))
  const encima = ocupan.filter((c) => c.startDateTime < args.endDateTime && args.startDateTime < c.endDateTime)

  const carga = (id: string) => ocupan.filter((c) => bookingBlocksProfessional(c, id)).length
  const chocan = (id: string) => encima.some((c) => bookingBlocksProfessional(c, id))

  return elegibles
    .map((p) => ({ id: p.id, choca: chocan(p.id), carga: carga(p.id) }))
    .sort((a, b) => Number(a.choca) - Number(b.choca) || a.carga - b.carga)
    .map((p) => p.id)
}

/**
 * Valida el horario y devuelve **a nombre de quién queda la reserva**. Es el único
 * lugar donde se resuelve "Cualquiera disponible", y corre adentro de la transacción,
 * después del advisory lock que toma el chequeo de solape.
 *
 * Que se resuelva acá y no en el navegador es la razón de ser de la función: entre que
 * la clienta ve "15:00 con cualquiera" y aprieta pagar, la persona que estaba libre
 * puede haber tomado otra cita. Resolver antes del lock es la misma carrera, sólo que
 * más corta.
 *
 * **Probar candidatos con el chequeo de verdad, y no con una copia liviana, es lo que
 * garantiza que no se pueda asignar a alguien que después rebota.** Lo que no depende
 * de la persona —la anticipación, la ventana, la duración— se pregunta una sola vez;
 * lo que sí, una por candidato, y el orden de `candidatesByLoad` hace que en el caso
 * normal la primera ya sirva.
 *
 * Atajar el `UserError` adentro de la transacción **sí** es seguro, a diferencia del
 * P2002 que documenta `p2002-inside-tx-cannot-be-caught`: eso es un error de Postgres y
 * aborta la transacción entera, esto lo tira nuestro código después de que todas las
 * consultas salieron bien. Y lo que se ataja es sólo `assertProfessionalIsFree`, que
 * habla de una persona: los motivos que valen para todo el mundo ya lanzaron arriba,
 * sin dar N vueltas para decir lo mismo. Cualquier otro error se re-lanza.
 */
export async function assertSlotAndResolveProfessional(
  input: Omit<AssertSlotInput, 'professionalId'> & {
    professional: ProfessionalPick
    /** La modalidad RESUELTA por `resolveBookingDraft`, no la que pidió el navegador. */
    modality: ServiceModality
  },
): Promise<string | null> {
  const { professional, modality, ...slot } = input

  await assertSlotIsBookable(slot)

  if (professional.kind !== 'anyone') {
    const professionalId = professional.kind === 'person' ? professional.id : null
    await assertProfessionalIsFree({ ...slot, professionalId })
    return professionalId
  }

  const candidatos = await candidatesByLoad(slot.tx, {
    businessId: slot.businessId,
    serviceId: slot.serviceId,
    modality,
    startDateTime: slot.startDateTime,
    endDateTime: slot.endDateTime,
    timezone: slot.timezone,
  })
  if (candidatos.length === 0) throw new UserError(NO_ONE_AVAILABLE_MESSAGE)

  for (const professionalId of candidatos) {
    try {
      await assertProfessionalIsFree({ ...slot, professionalId })
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
