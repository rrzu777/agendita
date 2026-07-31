import type { Prisma } from '@prisma/client'
import { acquireAdvisoryXactLock } from '@/lib/db/advisory-lock'
import { businessScheduleWhere, resolveRuleScope } from '@/lib/availability/scope'

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
 * El horario con el que arranca un negocio nuevo. Unifica las dos copias que estaban
 * escritas a mano en `create-for-user.ts` y `recover-business.ts`.
 *
 * **Quedan dos copias más que NO pueden importar esto y hay que mover a mano:**
 * `prisma/seed.ts` (corre con `ts-node --compiler-options module=CommonJS`, sin
 * resolución de alias, así que no ve `@/lib/...`) y `src/lib/data/mock-store.ts` (el
 * modo demo). La del seed es la que muerde: si el sábado se mueve acá y no allá, los
 * e2e de disponibilidad empiezan a fallar por una diferencia que no aparece en ningún
 * diff.
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

/**
 * Horas que se prellenan en un día que no tiene fila. **No** salen de
 * `DEFAULT_WEEKLY_SCHEDULE`: esa constante contesta "qué recibe un negocio nuevo", y si
 * además contestara "qué muestra el editor en un día cerrado", mover el sábado de la
 * siembra le cambiaría en silencio la pantalla a una dueña que nunca usó ese default.
 * Son dos preguntas distintas y cada una tiene su fuente.
 *
 * El día sale CERRADO igual, así que esto es sólo lo que aparece escrito si lo abre.
 */
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
    return { dayOfWeek, ...FALLBACK_HOURS, isActive: false }
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
/**
 * La clave del lock que serializa las escrituras del horario de una persona. Vive acá
 * y se exporta porque el lock protege el RECURSO `(negocio, persona)`, no esta función:
 * soltar el horario propio tiene que tomar el mismo, o un reset que caiga en medio de
 * una materialización queda deshecho sin que nadie se entere.
 */
export function scheduleLockKey(businessId: string, professionalId: string): string {
  return `availability-rules:${businessId}:${professionalId}`
}

export async function materializeProfessionalSchedule(
  tx: Prisma.TransactionClient,
  businessId: string,
  professionalId: string,
): Promise<void> {
  await acquireAdvisoryXactLock(tx, scheduleLockKey(businessId, professionalId))

  // La pregunta "¿ya tiene horario propio?" se hace donde vive la herencia y no se
  // rearma acá: es el MISMO `resolveRuleScope` que usan los lectores. Con un `count`
  // propio, el día que la regla cambie la escritura materializaría cuando la lectura
  // todavía cree que hereda — o se re-materializa en cada guardado, o quedan filas
  // duplicadas, que es justo lo que el lock de arriba está evitando.
  if ((await resolveRuleScope(tx, businessId, professionalId)) !== null) return

  const salon = await tx.availabilityRule.findMany({
    where: businessScheduleWhere(businessId),
    select: { dayOfWeek: true, startTime: true, endTime: true, isActive: true },
  })

  await tx.availabilityRule.createMany({
    data: projectWeek(salon).map((day) => ({ businessId, professionalId, ...day })),
  })
}
