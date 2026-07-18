import type { Prisma } from '@prisma/client'

/**
 * Hash estable de string → int32 (no-negativo) para claves de
 * pg_advisory_xact_lock. Colisiones sólo causan sobre-serialización ocasional
 * entre claves distintas, nunca pérdida de correctitud.
 */
export function hashStringToInt(str: string): number {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash
  }
  return Math.abs(hash)
}

/**
 * Toma un advisory lock a nivel de transacción keyed por `key`. Se libera solo
 * al commit/rollback de la tx (NO hay unlock explícito). Serializa secciones
 * críticas concurrentes que comparten `key` sin bloquear filas.
 *
 * DEBE llamarse dentro de una $transaction: pg_advisory_xact_lock atado a la tx.
 */
export async function acquireAdvisoryXactLock(tx: Prisma.TransactionClient, key: string): Promise<void> {
  // $executeRaw (no $queryRaw): pg_advisory_xact_lock devuelve void.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${hashStringToInt(key)})`
}
