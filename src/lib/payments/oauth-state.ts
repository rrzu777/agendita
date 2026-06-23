import { createHmac, createHash, timingSafeEqual } from 'crypto'

/**
 * HMAC key for OAuth state signing.
 *
 * Derived from ENCRYPTION_KEY but domain-separated so the same env secret is
 * never used directly for two cryptographic purposes (AES key derivation in
 * encryption.ts vs HMAC keying here). OAuth states are short-lived, so rotating
 * this derived key on deploy is harmless.
 */
function getSigningKey(): Buffer {
  const key = process.env.ENCRYPTION_KEY
  if (!key) {
    throw new Error('ENCRYPTION_KEY not configured')
  }
  return createHash('sha256').update(`oauth-state-hmac:${key}`).digest()
}

export function signState(payload: string): string {
  const key = getSigningKey()
  return createHmac('sha256', key).update(payload).digest('hex')
}

export function verifyStateSignature(payload: string, signature: string): boolean {
  try {
    const key = getSigningKey()
    const expected = createHmac('sha256', key).update(payload).digest('hex')
    return constantTimeEqual(signature, expected)
  } catch {
    return false
  }
}

/**
 * Constant-time string comparison that does not leak length via early return.
 * Both inputs are hashed to a fixed 32-byte digest first, so timingSafeEqual
 * always receives equal-length buffers regardless of the raw input lengths.
 */
function constantTimeEqual(a: string, b: string): boolean {
  const ah = createHash('sha256').update(a).digest()
  const bh = createHash('sha256').update(b).digest()
  return timingSafeEqual(ah, bh)
}
