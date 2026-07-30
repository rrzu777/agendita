/**
 * `Booking_no_overlap` es un EXCLUDE parcial de Postgres definido a mano en el SQL
 * de la migración `init` — no se puede expresar en schema.prisma, así que no
 * aparece en el modelo y es fácil olvidarse de que existe. Prohíbe dos reservas
 * del mismo negocio con horarios que se toquen, mirando SÓLO el status
 * (`pending_payment`, `confirmed`, `completed`).
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
