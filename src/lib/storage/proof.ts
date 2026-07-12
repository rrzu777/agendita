// Consts + helpers puros del comprobante de transferencia. Sin deps de red:
// lo importan tanto el cliente R2 como los server actions y los tests.

export const PROOF_ALLOWED_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
] as const

export type ProofContentType = (typeof PROOF_ALLOWED_TYPES)[number]

export const PROOF_MAX_BYTES = 5 * 1024 * 1024 // 5 MiB

export type ProofKind = 'deposit' | 'balance'

export function isAllowedProofType(t: string): t is ProofContentType {
  return (PROOF_ALLOWED_TYPES as readonly string[]).includes(t)
}

/** Clave determinística en R2. Re-subir sobrescribe el mismo objeto. */
export function proofKey(businessId: string, bookingId: string, kind: ProofKind): string {
  return `proofs/${businessId}/${bookingId}/${kind}`
}
