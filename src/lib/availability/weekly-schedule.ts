import type { Prisma } from '@prisma/client'
import { acquireAdvisoryXactLock } from '@/lib/db/advisory-lock'

/**
 * La semana de horario: cómo se proyecta para mostrarla y cómo se le copia a una
 * persona la primera vez que se le toca el horario.
 */

/** Un día de la semana tal como lo muestra y lo guarda el editor. Sin `id`: ver `projectWeek`. */
export type ScheduleDay = {
  dayOfWeek: number
  startTime: string
  endTime: string
  isActive: boolean
}

/**
 * El horario con el que arranca un negocio nuevo. Estaba escrito dos veces, igual y
 * a mano, en `create-for-user.ts` y en `recover-business.ts`.
 *
 * **Domingo no está**, y eso significa cerrado: la ausencia de fila es un día cerrado
 * en todo el proyecto (`resolveAvailabilityRules` filtra `isActive`, y un día sin fila
 * no aparece).
 */
export const DEFAULT_WEEKLY_SCHEDULE: readonly Omit<ScheduleDay, 'isActive'>[] = [
  { dayOfWeek: 1, startTime: '09:00', endTime: '18:00' },
  { dayOfWeek: 2, startTime: '09:00', endTime: '18:00' },
  { dayOfWeek: 3, startTime: '09:00', endTime: '18:00' },
  { dayOfWeek: 4, startTime: '09:00', endTime: '18:00' },
  { dayOfWeek: 5, startTime: '09:00', endTime: '18:00' },
  { dayOfWeek: 6, startTime: '10:00', endTime: '15:00' },
]

/** Horas de relleno para un día que no tiene fila: se muestra cerrado y prellenado. */
const FALLBACK_HOURS = { startTime: '09:00', endTime: '18:00' }

/**
 * Un conjunto de reglas → **los 7 días, siempre**, ordenados de domingo a sábado. El
 * día que no tiene fila sale cerrado.
 *
 * Las dos puntas —lo que la pantalla muestra y lo que la copia escribe— pasan por acá,
 * y eso es el punto: si la lectura proyectara 7 días y la escritura copiara sólo las
 * filas que existen, editar el domingo de alguien sería un `updateMany` con `count: 0`
 * que devuelve "guardado" sin guardar nada.
 *
 * **Y no devuelve `id`.** Cuando una persona hereda, las filas que rigen son las DEL
 * SALÓN: si sus ids salieran de acá, la pantalla de esa persona tendría en la mano
 * exactamente lo que hace falta para editar el horario del salón creyendo que edita el
 * de ella. Sin ids, el editor por persona sólo puede escribir por `(persona, día)`.
 */
export function projectWeek(rules: readonly ScheduleDay[]): ScheduleDay[] {
  const byDay = new Map(rules.map((r) => [r.dayOfWeek, r]))
  return Array.from({ length: 7 }, (_, dayOfWeek) => {
    const existing = byDay.get(dayOfWeek)
    if (existing) {
      return {
        dayOfWeek,
        startTime: existing.startTime,
        endTime: existing.endTime,
        isActive: existing.isActive,
      }
    }
    const preset = DEFAULT_WEEKLY_SCHEDULE.find((d) => d.dayOfWeek === dayOfWeek)
    return {
      dayOfWeek,
      startTime: preset?.startTime ?? FALLBACK_HOURS.startTime,
      endTime: preset?.endTime ?? FALLBACK_HOURS.endTime,
      isActive: false,
    }
  })
}

/**
 * Le da a una persona su **propio** horario, copiándole el del salón. No hace nada si
 * ya tiene uno.
 *
 * A partir de acá esa persona deja de heredar (ver `resolveRuleScope` en `scope.ts`:
 * una sola fila propia corta la herencia, y la pregunta no filtra `isActive`).
 *
 * **Copia la semana ENTERA en una sola operación, y ahí está todo el peligro.** La
 * herencia es todo-o-nada: en cuanto exista una fila propia, los días que no se
 * copiaron no vuelven al horario del salón — quedan **cerrados**. Materializar sólo el
 * día que se está editando dejaría a esa persona sin atender de martes a domingo por
 * haberle cambiado la hora del lunes, sin ningún error en ningún lado. Por eso la copia
 * es `projectWeek` de los 7 días y no un `create` del día tocado.
 *
 * Va adentro de una transacción y toma un advisory lock por `(negocio, persona)`: dos
 * pestañas guardando dos días distintos a la vez leerían las dos "no tiene horario
 * propio" y copiarían la semana dos veces. `AvailabilityRule` **no tiene unique** sobre
 * `(businessId, professionalId, dayOfWeek)` —sólo índices—, así que la base no lo
 * atajaría: quedarían 14 filas y la mitad de los días con dos horarios.
 */
export async function materializeProfessionalSchedule(
  tx: Prisma.TransactionClient,
  businessId: string,
  professionalId: string,
): Promise<void> {
  await acquireAdvisoryXactLock(tx, `availability-rules:${businessId}:${professionalId}`)

  const own = await tx.availabilityRule.count({ where: { businessId, professionalId } })
  if (own > 0) return

  const salon = await tx.availabilityRule.findMany({
    where: { businessId, professionalId: null },
    select: { dayOfWeek: true, startTime: true, endTime: true, isActive: true },
  })

  await tx.availabilityRule.createMany({
    data: projectWeek(salon).map((day) => ({ businessId, professionalId, ...day })),
  })
}
