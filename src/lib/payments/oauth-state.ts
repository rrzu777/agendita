import { createHmac } from 'crypto'

function getSigningKey(): string {
  const key = process.env.ENCRYPTION_KEY
  if (!key) {
    throw new Error('ENCRYPTION_KEY not configured')
  }
  return key
}

export function signState(payload: string): string {
  const key = getSigningKey()
  return createHmac('sha256', key).update(payload).digest('hex')
}

export function verifyStateSignature(payload: string, signature: string): boolean {
  try {
    const key = getSigningKey()
    const expected = createHmac('sha256', key).update(payload).digest('hex')
    return timingSafeEqualStr(signature, expected)
  } catch {
    return false
  }
}

function timingSafeEqualStr(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let result = 0
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return result === 0
}
