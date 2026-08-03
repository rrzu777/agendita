import { Prisma } from '@prisma/client'
import type { AvailabilityRule, PrismaClient } from '@prisma/client'
import { RELEASED_STATUSES } from '@/lib/bookings/approval'

/**
 * Dado un negocio y una persona (o ninguna), **qué reglas, qué bloqueos y qué
 * reservas cuentan**. Las tres respuestas viven acá porque se contestan distinto y
 * esa diferencia es fácil de perder si están desparramadas: para el negocio, los
 * bloqueos que cuentan son sólo los suyos pero las reservas son todas.
 *
 * Cada respuesta tiene además **dos formas**, y las dos viven pegadas: una condición
 * de Prisma para los lectores y —cuando hace falta— el fragmento SQL equivalente
 * para el `$queryRaw` de la validación. Separarlas es cómo se llega a que el funnel
 * ofrezca una hora que la escritura rechaza.
 *
 * Mientras ninguna fila tenga `professionalId` —el estado de hoy— las tres resuelven
 * exactamente al comportamiento actual.
 */

/** Prisma o una transacción: la validación al escribir corre dentro de una. */
type Db = PrismaClient | Prisma.TransactionClient

/**
 * Todo lo que no sea un id de verdad es "sin persona".
 *
 * El tipo dice `string | null` y adentro de `src` el compilador lo sostiene, pero los
 * argumentos de una server action llegan del cliente y pueden ser cualquier cosa —
 * incluido un bundle viejo que manda un argumento de menos durante un deploy. Un
 * `undefined` que se cuele hace daño en **dos direcciones opuestas**:
 *
 * - en un `where` de Prisma **no filtra nada**, así que el alcance "de una persona
 *   sin id" matchea el horario y los bloqueos de TODO el equipo;
 * - en el SQL crudo llega a Postgres como NULL, y `"professionalId" = NULL` nunca es
 *   cierto: la reserva **deja de chocar** contra las citas de la gente.
 *
 * Esto defiende la FORMA, no la procedencia: que el id exista, sea de este negocio y
 * esté activo lo chequea quien recibe el dato (ver `_getAvailableTimeSlots`).
 */
export function normalizeProfessionalId(professionalId: string | null): string | null {
  return typeof professionalId === 'string' && professionalId.length > 0 ? professionalId : null
}

// ─── Bloqueos ────────────────────────────────────────────────────────────────

/**
 * De quién son los bloqueos que cuentan. Es un tipo y no un `professionalId`
 * opcional por tres motivos, y los tres ya mordieron en este repo:
 *
 * 1. **`null` y "todos" no son lo mismo.** Un bloqueo con `professionalId = null`
 *    cierra para todo el negocio; los de una persona son sólo suyos. El calendario
 *    del panel tiene que MOSTRAR los de todo el equipo, y el cálculo de slots del
 *    negocio tiene que IGNORARLOS —las vacaciones de Juan no cierran el local—. Con
 *    un solo `null` para las dos cosas, una de las dos queda mal.
 * 2. **Un `undefined` en un `where` de Prisma no filtra: matchea todo.** Un
 *    parámetro obligatorio con casos nombrados no puede llegar en `undefined`.
 * 3. **El orden posicional era una trampa**: `timezone` y `professionalId` son los
 *    dos `string` y cambiarlos de lugar compilaba. Por eso la firma es un objeto.
 */
export type BlockScope =
  /** Sólo los del negocio (`professionalId = null`). El comportamiento de siempre. */
  | { kind: 'business' }
  /** Los del negocio MÁS los de esa persona: los dos la dejan sin atender. */
  | { kind: 'professional'; professionalId: string }
  /**
   * Todos, de cualquiera. Es el alcance de **mostrar** (el calendario del panel) y
   * no sirve para calcular slots: con `everyone`, las vacaciones de una sola persona
   * cerrarían el local. `blockScopeFor` nunca lo produce, justamente para que no se
   * cuele en un cálculo por accidente.
   */
  | { kind: 'everyone' }

/** Alcance de bloqueos que le corresponde a una persona, o al negocio si no hay. */
export function blockScopeFor(professionalId: string | null): BlockScope {
  const id = normalizeProfessionalId(professionalId)
  return id === null ? { kind: 'business' } : { kind: 'professional', professionalId: id }
}

/**
 * Condición de `professionalId` para un alcance. Va **adentro de un `AND`** y no
 * desparramada con spread: la query de series ya tiene su propio `OR` (el de `until`)
 * y un segundo `OR` en el mismo nivel lo sobrescribe en silencio, con lo que la serie
 * perdería el filtro de fecha de fin.
 *
 * El tipo es la intersección de los dos `WhereInput` porque la usan las dos queries,
 * la de bloqueos sueltos y la de series.
 */
export function blockScopeCondition(
  scope: BlockScope,
): Prisma.TimeBlockWhereInput & Prisma.TimeBlockSeriesWhereInput {
  switch (scope.kind) {
    case 'business':
      return { professionalId: null }
    case 'professional':
      return { OR: [{ professionalId: null }, { professionalId: scope.professionalId }] }
    case 'everyone':
      return {}
  }
}

/**
 * La MISMA regla que `blockScopeCondition({ kind: 'professional' })`, pero **en
 * memoria**, sobre bloqueos ya traídos: ¿este bloqueo le tapa el horario a esta
 * persona?
 *
 * Existe para el cálculo de "cualquiera disponible", que necesita los bloqueos de
 * varias personas a la vez: los trae UNA vez con alcance `everyone` y reparte acá, en
 * vez de una query por persona. Ojo que `everyone` **no** sirve para calcular slots tal
 * cual —las vacaciones de una sola persona cerrarían el local—; lo que lo vuelve
 * correcto es justamente este filtro, que reconstruye el alcance de cada una.
 *
 * Vive pegada a su hermana de Prisma por el mismo motivo que
 * `bookingBlocksProfessional`: son la lectura y la escritura del mismo contrato.
 */
export function blockAppliesToProfessional(
  block: { professionalId: string | null },
  professionalId: string,
): boolean {
  const dueña = normalizeProfessionalId(block.professionalId)
  return dueña === null || dueña === professionalId
}

// ─── Reservas ────────────────────────────────────────────────────────────────

/**
 * Qué reservas ocupan el horario de esta persona (o del negocio).
 *
 * **Ojo la asimetría con los bloqueos, que es a propósito y va en la dirección
 * segura:** para el negocio, los bloqueos que cuentan son SÓLO los suyos
 * (`professionalId = null`) pero las reservas que cuentan son TODAS.
 *
 * El motivo es qué pasa si se equivoca cada una. Dar de baja a todo el equipo
 * devuelve el negocio al modo de hoy, pero las citas que esa gente ya tenía conservan
 * su `professionalId`. Si el modo negocio filtrara las reservas a las de
 * `professionalId = null`, esas citas se volverían invisibles y el funnel ofrecería
 * una hora que ya está tomada: **doble reserva sobre una cita real**. Al revés no hay
 * daño simétrico: las vacaciones de alguien que ya no atiende no tienen por qué
 * cerrar el local.
 *
 * Como `blockScopeCondition`, va adentro de un `AND`: varias de estas queries ya
 * tienen su propio `OR` (el de los holds vencidos).
 */
export function bookingScopeCondition(professionalId: string | null): Prisma.BookingWhereInput {
  const id = normalizeProfessionalId(professionalId)
  if (id === null) return {}
  return { OR: [{ professionalId: null }, { professionalId: id }] }
}

/**
 * Las citas que ocupan cupo en un día del negocio. Es la otra mitad del `where` de
 * disponibilidad —`bookingScopeCondition` dice de quién, esto dice cuáles— y estaba
 * escrita a mano en cuatro lugares: los dos lectores de horarios, el de reprogramar y
 * el reparto de "cualquiera disponible".
 *
 * Vale la pena tenerla junta porque **la lista de estados no está cerrada**:
 * `pending_confirmation` ocupa cupo para la app aunque el EXCLUDE de la base lo ignore,
 * y el día que eso se acomode hay que tocar un solo lugar. Con cuatro copias, olvidarse
 * de una hace que la pantalla ofrezca una hora que la escritura rechaza — o que el
 * reparto cuente una carga distinta de la que se mostró.
 *
 * El rango es por SOLAPE con el día, no por fecha de creación: una cita que empieza
 * antes y termina adentro cuenta.
 */
export function bookingsOfDayWhere(
  businessId: string,
  dayStart: Date,
  dayEnd: Date,
): Prisma.BookingWhereInput {
  return {
    businessId,
    status: { notIn: [...RELEASED_STATUSES] },
    startDateTime: { lte: dayEnd },
    endDateTime: { gte: dayStart },
  }
}

/**
 * La MISMA regla que `bookingScopeCondition`, pero **en memoria**, sobre una fila ya
 * traída: ¿esta reserva le tapa el horario a esta persona?
 *
 * Existe porque la validación al escribir no puede filtrar por persona en su query.
 * Esa query trae las filas con `FOR UPDATE` para que el sweep de holds abandonados
 * pueda barrerlos, y el EXCLUDE `Booking_no_overlap` es por NEGOCIO: si la query se
 * acotara a una persona, un hold vencido de otra quedaría sin barrer y el insert
 * moriría con un 23P01 que nadie puede explicar. Así que se trae todo y la persona se
 * aplica recién al decidir qué bloquea.
 *
 * Vive pegada a su hermana de Prisma a propósito: son la lectura y la escritura del
 * mismo contrato, y separarlas es cómo se llega a que el funnel ofrezca una hora que
 * la escritura rechaza.
 */
export function bookingBlocksProfessional(
  row: { professionalId: string | null },
  professionalId: string | null,
): boolean {
  // Normaliza los DOS lados, y en los dos casos el valor ausente significa "sin
  // persona", que es el lado conservador: si la reserva NUEVA no tiene persona,
  // cualquier cita le tapa la hora; si la fila que vino de la base no tiene dueño
  // —o llegó sin el campo—, le tapa la hora a cualquiera.
  const nueva = normalizeProfessionalId(professionalId)
  if (nueva === null) return true
  const dueña = normalizeProfessionalId(row.professionalId)
  return dueña === null || dueña === nueva
}

// ─── Reglas de horario ───────────────────────────────────────────────────────

/**
 * **Acá vive la regla de herencia**, y los dos lectores de abajo la llaman en vez de
 * rearmarla. Devuelve de quién son las reglas que rigen:
 *
 * - sin persona → las del negocio (`professionalId = null`), las de hoy
 * - persona **con** filas propias → las suyas
 * - persona **sin ninguna** fila propia → las del negocio
 *
 * La alternativa era sembrarle 7 reglas a cada persona al crearla. Se descartó porque
 * después la dueña cambia el horario del salón y no se propaga: se queda editando N+1
 * horarios sin entender por qué el nuevo no aplica. Con herencia, sumar gente no
 * puede romperle la disponibilidad a nadie.
 *
 * **La herencia es todo-o-nada, no por día.** Por día, alguien que trabaja sólo los
 * sábados heredaría el horario del negocio de lunes a viernes — lo contrario de lo
 * que la dueña configuró.
 *
 * **Y la existencia se pregunta SIN filtrar por `isActive`**, que es el borde que
 * invierte el sentido: una persona con sus 7 días cerrados tiene horario propio (está
 * cerrada). Si la pregunta filtrara los activos, cerrarle toda la semana la dejaría
 * **abierta en el horario del salón**.
 */
/**
 * "El horario del salón", como concepto y no como literal suelto. Lo preguntan cuatro
 * lugares —el editor semanal y los tres contadores de onboarding— y en los tres
 * contadores el filtro **faltaba**: contaban las reglas de todo el equipo, así que un
 * salón de 4 personas decía 28 días de atención.
 *
 * Existe para que la quinta copia nazca con el filtro puesto. Mismo patrón que
 * `pendingPackageTransferWhere`, que se usa en la línea de al lado en `dashboard/page.tsx`.
 */
export function businessScheduleWhere(businessId: string): Prisma.AvailabilityRuleWhereInput {
  return { businessId, professionalId: null }
}

export async function resolveRuleScope(
  client: Db,
  businessId: string,
  professionalId: string | null,
): Promise<string | null> {
  const id = normalizeProfessionalId(professionalId)
  if (id === null) return null
  const own = await client.availabilityRule.count({ where: { businessId, professionalId: id } })
  return own > 0 ? id : null
}

/**
 * La MISMA herencia que `resolveRuleScope`, pero **en memoria**, sobre las reglas del
 * negocio y de todo el equipo ya traídas: ¿cuáles rigen a esta persona?
 *
 * Existe para el cálculo de "cualquiera disponible", que necesita el horario de varias
 * personas a la vez y las trae en una sola query en vez de dos por cabeza.
 *
 * **Recibe las filas SIN filtrar por `isActive` y devuelve sólo las activas**, igual
 * que `resolveAvailabilityRules`. Los dos pasos son distintos y el orden importa: tener
 * horario propio se decide por la EXISTENCIA de filas, no por que estén activas —
 * alguien con sus 7 días cerrados está cerrado, y si la existencia mirara `isActive`
 * quedaría abierto en el horario del salón—; recién después se filtra qué días atiende.
 * Por eso el caller tiene que pasarle TODAS las filas del negocio, sin filtro previo.
 */
export function rulesForProfessional<T extends { professionalId: string | null; isActive: boolean }>(
  todas: T[],
  professionalId: string,
): T[] {
  const propias = todas.filter((r) => normalizeProfessionalId(r.professionalId) === professionalId)
  const rigen = propias.length > 0 ? propias : todas.filter((r) => r.professionalId === null)
  return rigen.filter((r) => r.isActive)
}

/** Las reglas activas que rigen a una persona (o al negocio), con la herencia. */
export async function resolveAvailabilityRules(
  client: Db,
  businessId: string,
  professionalId: string | null,
): Promise<AvailabilityRule[]> {
  return client.availabilityRule.findMany({
    where: {
      businessId,
      professionalId: await resolveRuleScope(client, businessId, professionalId),
      isActive: true,
    },
    orderBy: { dayOfWeek: 'asc' },
  })
}

/**
 * La regla de UN día, con la misma herencia. Existe aparte porque el camino crítico
 * de reservar sólo necesita un día y el filtro va en la query.
 */
export async function resolveDayRule(
  client: Db,
  businessId: string,
  professionalId: string | null,
  dayOfWeek: number,
): Promise<{ startTime: string; endTime: string } | null> {
  return client.availabilityRule.findFirst({
    where: {
      businessId,
      professionalId: await resolveRuleScope(client, businessId, professionalId),
      dayOfWeek,
      isActive: true,
    },
    select: { startTime: true, endTime: true },
  })
}
