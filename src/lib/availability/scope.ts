import type { AvailabilityRule, Prisma, PrismaClient } from '@prisma/client'
import type { BlockScope } from '@/lib/availability/effective-blocks'

/**
 * Dado un negocio y una persona (o ninguna), qué reglas, qué bloqueos y qué
 * reservas cuentan. Los tres lectores de slots y la validación al escribir pasan
 * por acá, así que las tres respuestas viven juntas: se contestan distinto y esa
 * diferencia es fácil de perder si están desparramadas.
 *
 * Mientras ninguna fila tenga `professionalId` —el estado de hoy— las tres
 * resuelven exactamente al comportamiento actual.
 */

/**
 * Todo lo que no sea un id de verdad es "sin persona".
 *
 * El tipo dice `string | null` y adentro de `src` el compilador lo sostiene, pero
 * los argumentos de una server action llegan del cliente y pueden ser cualquier
 * cosa. Un `undefined` que se cuele NO es inocuo: `{ professionalId: undefined }`
 * en un `where` de Prisma no filtra nada, así que el alcance "de una persona sin
 * id" termina matcheando el horario y los bloqueos de TODO el equipo. Un test con
 * un fixture al que le faltaba el campo ya lo demostró.
 *
 * En el SQL crudo del solape el daño va para el otro lado y es peor: un `undefined`
 * interpolado llega a Postgres como NULL, `"professionalId" = NULL` nunca es cierto
 * y la reserva dejaría de chocar contra las citas de la gente. Por eso normaliza
 * todo el mundo, incluido `validation.ts`, y no sólo los constructores de `where`.
 */
export function normalizeProfessionalId(professionalId: string | null): string | null {
  return typeof professionalId === 'string' && professionalId.length > 0 ? professionalId : null
}

/** Alcance de bloqueos que le corresponde a una persona, o al negocio si no hay. */
export function blockScopeFor(professionalId: string | null): BlockScope {
  const id = normalizeProfessionalId(professionalId)
  return id === null ? { kind: 'business' } : { kind: 'professional', professionalId: id }
}

/**
 * Qué reservas ocupan el horario de esta persona (o del negocio).
 *
 * **Ojo la asimetría con los bloqueos, que es a propósito y va en la dirección
 * segura:** para el negocio, los bloqueos que cuentan son SÓLO los suyos
 * (`professionalId = null`) pero las reservas que cuentan son TODAS.
 *
 * El motivo es qué pasa si se equivoca cada una. Dar de baja a todo el equipo
 * devuelve el negocio al modo de hoy, pero las citas que esa gente ya tenía
 * conservan su `professionalId`. Si el modo negocio filtrara las reservas a las
 * de `professionalId = null`, esas citas se volverían invisibles y el funnel
 * ofrecería una hora que ya está tomada: **doble reserva sobre una cita real**.
 * Al revés no hay daño simétrico: las vacaciones de alguien que ya no atiende no
 * tienen por qué cerrar el local.
 *
 * Devuelve una condición pensada para ir adentro de un `AND`, no para
 * desparramar con spread: varias de estas queries ya tienen su propio `OR` (el de
 * los holds vencidos) y un segundo `OR` en el mismo nivel lo sobrescribe callado.
 */
export function bookingScopeCondition(professionalId: string | null): Prisma.BookingWhereInput {
  const id = normalizeProfessionalId(professionalId)
  if (id === null) return {}
  // Una reserva sin persona choca contra todos: es de antes de que el negocio
  // tuviera equipo y nunca queremos meterle una cita encima a alguien.
  return { OR: [{ professionalId: null }, { professionalId: id }] }
}

/**
 * ¿Esta persona tiene horario propio? **Acá vive la regla de herencia** y los dos
 * lectores de abajo la consultan en vez de reimplementarla:
 *
 * - sin persona → las reglas del negocio (`professionalId = null`), las de hoy
 * - persona **con** filas propias → sólo las suyas
 * - persona **sin ninguna** fila propia → las del negocio
 *
 * La alternativa era sembrarle 7 reglas a cada persona al crearla. Se descartó
 * porque después la dueña cambia el horario del salón y no se propaga: se queda
 * editando N+1 horarios sin entender por qué el nuevo no aplica. Con herencia,
 * sumar gente no puede romperle la disponibilidad a nadie.
 *
 * **La herencia es todo-o-nada, no por día.** Por día, alguien que trabaja sólo
 * los sábados heredaría el horario del negocio de lunes a viernes — lo contrario
 * de lo que la dueña configuró.
 *
 * **Y la existencia se pregunta SIN filtrar por `isActive`**, que es el borde que
 * invierte el sentido: una persona con sus 7 días cerrados tiene horario propio
 * (está cerrada). Si la pregunta filtrara los activos, cerrarle toda la semana la
 * dejaría "sin filas propias" y por lo tanto **abierta en el horario del salón**.
 *
 * Los dos lectores de abajo reciben el cliente porque la validación al escribir
 * una reserva corre dentro de una transacción y tiene que ver lo mismo que ella.
 *
 * @see hasOwnAvailabilityRules — la regla vive ahí y no duplicada en cada lector.
 */
export async function hasOwnAvailabilityRules(
  client: PrismaClient | Prisma.TransactionClient,
  businessId: string,
  professionalId: string,
): Promise<boolean> {
  const count = await client.availabilityRule.count({ where: { businessId, professionalId } })
  return count > 0
}

/** Las 7 reglas activas que rigen a una persona (o al negocio), con la herencia. */
export async function resolveAvailabilityRules(
  client: PrismaClient | Prisma.TransactionClient,
  businessId: string,
  professionalId: string | null,
): Promise<AvailabilityRule[]> {
  const id = normalizeProfessionalId(professionalId)
  const scoped = id !== null && (await hasOwnAvailabilityRules(client, businessId, id)) ? id : null

  return client.availabilityRule.findMany({
    where: { businessId, professionalId: scoped, isActive: true },
    orderBy: { dayOfWeek: 'asc' },
  })
}

/**
 * La regla de UN día, con la misma herencia. Existe aparte de
 * `resolveAvailabilityRules` porque el camino crítico de reservar sólo necesita un
 * día y el filtro va en la query, no en memoria: las dos comparten el predicado de
 * herencia, que es lo que no puede desincronizarse.
 */
export async function resolveDayRule(
  client: PrismaClient | Prisma.TransactionClient,
  businessId: string,
  professionalId: string | null,
  dayOfWeek: number,
): Promise<{ startTime: string; endTime: string } | null> {
  const id = normalizeProfessionalId(professionalId)
  const scoped = id !== null && (await hasOwnAvailabilityRules(client, businessId, id)) ? id : null

  return client.availabilityRule.findFirst({
    where: { businessId, professionalId: scoped, dayOfWeek, isActive: true },
    select: { startTime: true, endTime: true },
  })
}
