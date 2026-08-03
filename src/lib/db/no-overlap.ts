/**
 * `Booking_no_overlap` es un EXCLUDE parcial de Postgres definido a mano en el SQL
 * de las migraciones — no se puede expresar en schema.prisma, así que no aparece
 * en el modelo y es fácil olvidarse de que existe. Prohíbe dos reservas del mismo
 * negocio Y de la misma persona con horarios que se toquen, mirando SÓLO el status
 * (`pending_payment`, `pending_confirmation`, `confirmed`, `completed`).
 *
 * Su definición vigente está en `booking_overlap_solicitudes`, no en `init`: cada
 * cambio la recrea entera, así que la última migración que la nombra es la única
 * que vale.
 *
 * Mirar sólo el status es lo que lo hace más estricto que la app: para el
 * constraint un hold vencido sigue ocupando el horario. `occupiesSlot` y
 * `sweepStaleHoldsInTx` existen para que las dos visiones coincidan; esto es la
 * red por si igual se escapa una.
 */

/**
 * True si el error es un rechazo de `Booking_no_overlap` (Postgres 23P01).
 *
 * Se detecta por el nombre del constraint en el mensaje o en `meta`: Prisma no lo
 * mapea a un código conocido — llega como `PrismaClientUnknownRequestError`, que
 * ni siquiera tiene `.code`, así que cualquier catch que filtre por código lo deja
 * pasar como "error inesperado".
 *
 * El catch va SIEMPRE afuera del `$transaction`: después de un 23P01 la transacción
 * queda abortada y no se puede seguir usando (mismo mecanismo que el P2002). Atajarlo
 * adentro de un helper `*InTx` "funciona" sólo mientras ese helper no tenga nada
 * después del write — y eso no es una garantía que un helper compartido pueda dar: el
 * día que un caller le componga trabajo adentro de la misma tx, la query siguiente
 * muere con "current transaction is aborted".
 *
 * Y el mensaje es de la OPERACIÓN, no del constraint: el mismo rechazo sale como
 * "elegí otra hora" al reservar o reprogramar, y como "esa persona está ocupada" al
 * reasignar. Por eso la traducción vive en cada action y no en un wrapper común.
 */
export function isNoOverlapViolation(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e)
  const meta = (e as { meta?: unknown } | null)?.meta
  let metaStr = ''
  try {
    metaStr = JSON.stringify(meta ?? {})
  } catch {
    // meta puede traer BigInt u otros valores no serializables por JSON.stringify
    // (p.ej. counts de Postgres); no dejamos que eso enmascare el error original.
    metaStr = ''
  }
  return `${msg} ${metaStr}`.includes('Booking_no_overlap')
}
