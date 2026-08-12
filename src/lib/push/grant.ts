import { createHash, createHmac, timingSafeEqual } from 'crypto'

const TOKEN_DOMAIN = 'push-grant'
const TOKEN_VERSION = 'v1'
const TOKEN_PREFIX = `${TOKEN_DOMAIN}.${TOKEN_VERSION}`
const GRANT_LIFETIME_MS = 24 * 60 * 60 * 1000
const MAX_TOKEN_LENGTH = 4096
const MAX_IDENTIFIER_LENGTH = 191

export interface PushGrantClaims {
  version: 1
  bookingId: string
  customerId: string
  businessId: string
  expiresAt: number
}

type GrantSubject = Pick<PushGrantClaims, 'bookingId' | 'customerId' | 'businessId'>

function getSigningKey(): Buffer {
  const key = process.env.ENCRYPTION_KEY
  if (!key) throw new Error('ENCRYPTION_KEY not configured')
  return createHash('sha256').update(`push-grant-hmac:${key}`).digest()
}

function validIdentifier(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_IDENTIFIER_LENGTH
}

function isPushGrantClaims(value: unknown): value is PushGrantClaims {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const claims = value as Record<string, unknown>
  const keys = Object.keys(claims)
  return keys.length === 5
    && keys.every((key) => ['version', 'bookingId', 'customerId', 'businessId', 'expiresAt'].includes(key))
    && claims.version === 1
    && validIdentifier(claims.bookingId)
    && validIdentifier(claims.customerId)
    && validIdentifier(claims.businessId)
    && typeof claims.expiresAt === 'number'
    && Number.isSafeInteger(claims.expiresAt)
}

function signatureFor(payload: string): string {
  return createHmac('sha256', getSigningKey()).update(`${TOKEN_PREFIX}.${payload}`).digest('hex')
}

/** Hashes both strings first so timingSafeEqual always receives 32 bytes. */
function constantTimeEqual(a: string, b: string): boolean {
  const aHash = createHash('sha256').update(a).digest()
  const bHash = createHash('sha256').update(b).digest()
  return timingSafeEqual(aHash, bHash)
}

export function issuePushGrant(subject: GrantSubject, now = new Date()): string {
  if (!validIdentifier(subject.bookingId)
    || !validIdentifier(subject.customerId)
    || !validIdentifier(subject.businessId)) {
    throw new Error('Invalid push grant subject')
  }

  const claims: PushGrantClaims = {
    version: 1,
    bookingId: subject.bookingId,
    customerId: subject.customerId,
    businessId: subject.businessId,
    expiresAt: now.getTime() + GRANT_LIFETIME_MS,
  }
  const payload = Buffer.from(JSON.stringify(claims), 'utf8').toString('base64url')
  return `${TOKEN_PREFIX}.${payload}.${signatureFor(payload)}`
}

export function verifyPushGrant(token: string, now = new Date()): PushGrantClaims | null {
  try {
    if (typeof token !== 'string' || token.length === 0 || token.length > MAX_TOKEN_LENGTH) return null
    const parts = token.split('.')
    if (parts.length !== 4) return null
    const [domain, version, payload, signature] = parts
    if (domain !== TOKEN_DOMAIN || version !== TOKEN_VERSION) return null
    if (!/^[A-Za-z0-9_-]+$/.test(payload) || !signature) return null
    if (!constantTimeEqual(signature, signatureFor(payload))) return null

    const decoded = Buffer.from(payload, 'base64url').toString('utf8')
    // Buffer's decoder is permissive; require the canonical encoding we issue.
    if (Buffer.from(decoded, 'utf8').toString('base64url') !== payload) return null
    const claims: unknown = JSON.parse(decoded)
    if (!isPushGrantClaims(claims)) return null

    const nowMs = now.getTime()
    if (!Number.isFinite(nowMs)) return null
    if (claims.expiresAt <= nowMs || claims.expiresAt > nowMs + GRANT_LIFETIME_MS) return null
    return claims
  } catch {
    return null
  }
}
