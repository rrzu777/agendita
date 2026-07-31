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
 * La clave del lock que serializa las escrituras de UN horario. Vive acá y se exporta
 * porque el lock protege el RECURSO `(negocio, alcance)`, no esta función: soltar el
 * horario propio tiene que tomar el mismo, o un reset que caiga en medio de una
 * materialización queda deshecho sin que nadie se entere.
 *
 * `null` es el horario del salón y tiene su propia llave: no comparte lock con nadie
 * —el salón y una persona se escriben en paralelo sin tocarse— pero tampoco puede
 * quedar sin llave, porque escribir un día que no tiene fila también es un
 * "leer y después crear" que dos pestañas duplicarían.
 *
 * El prefijo `p:` está para que un id que fuera literalmente `salon` no colisione con
 * el salón. Hoy son cuids y no puede pasar; el día que los ids los elija otra cosa,
 * esta llave ya está a salvo.
 */
export function scheduleLockKey(businessId: string, professionalId: string | null): string {
  const scope = professionalId === null ? 'salon' : `p:${professionalId}`
  return `availability-rules:${businessId}:${scope}`
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

/**
 * Guarda **un día** del horario de un alcance: `null` es el salón, un id es esa persona.
 *
 * Es la única escritura del horario semanal, y que sea una sola es el punto. Antes eran
 * dos: el salón se editaba **por id de regla** y una persona por `(persona, día)`. La
 * consecuencia no era teórica — el salón **no podía abrir el domingo**, porque el
 * negocio se siembra sin fila de domingo, sin fila no hay id, y sin id el editor no
 * tenía qué mandar. Un negocio que atiende domingo no tenía forma de decirlo.
 *
 * Por eso escribe por `(negocio, alcance, día)`, que es la identidad real de un día de
 * horario, y **crea la fila si no existe**. Eso también repara el caso de filas propias
 * parciales —un backfill que dejó 3 de 7—, que la materialización nunca completa porque
 * tres filas ya cuentan como "tiene horario propio".
 *
 * El orden importa: lock, materializar, recién ahí escribir. Ver
 * `materializeProfessionalSchedule` — copiar sólo el día editado deja a esa persona
 * cerrada el resto de la semana.
 */
export async function setWeekday(
  tx: Prisma.TransactionClient,
  businessId: string,
  professionalId: string | null,
  day: ScheduleDay,
): Promise<void> {
  // El lock se toma acá aunque la materialización tome el mismo un renglón más abajo, y
  // no es un descuido: `pg_advisory_xact_lock` es re-entrante dentro de la misma
  // transacción (una sesión que ya tiene el lock lo vuelve a obtener sin esperar) y se
  // suelta solo al commitear. Tomarlo acá deja la garantía en ESTA función, que es la
  // que la necesita para las dos ramas — el salón no materializa nada y quedaría sin
  // lock si dependiera de la de abajo.
  await acquireAdvisoryXactLock(tx, scheduleLockKey(businessId, professionalId))

  if (professionalId !== null) {
    await materializeProfessionalSchedule(tx, businessId, professionalId)
  }

  const { dayOfWeek, startTime, endTime, isActive } = day
  // `updateMany` y no `update`: la clave es `(negocio, alcance, día)` y no hay unique
  // que la respalde, así que no existe un `where` de `update` que la exprese. Y si
  // quedaron filas duplicadas de antes, las actualiza a todas — convergen en vez de
  // dejar una vieja rigiendo al azar.
  const updated = await tx.availabilityRule.updateMany({
    where: { businessId, professionalId, dayOfWeek },
    data: { startTime, endTime, isActive },
  })

  if (updated.count === 0) {
    await tx.availabilityRule.create({
      data: { businessId, professionalId, dayOfWeek, startTime, endTime, isActive },
    })
  }
}
