import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto'

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 16
const AUTH_TAG_LENGTH = 16
const SALT_LENGTH = 16
// Legacy fixed salt — kept only to decrypt tokens written before per-record
// salts were introduced. Never used for new ciphertexts.
const LEGACY_SALT = 'agendita-mp-encryption-v1'
// Marks the v2 format: a random per-record salt is prepended to the payload.
const V2_PREFIX = 'v2:'

function getSecret(): string {
  const secret = process.env.ENCRYPTION_KEY
  if (!secret) {
    throw new Error('ENCRYPTION_KEY not configured')
  }
  return secret
}

function deriveKey(secret: string, salt: Buffer | string): Buffer {
  return scryptSync(secret, salt, 32)
}

export function encryptSecret(plaintext: string): string {
  const secret = getSecret()
  // Random per-record salt: a fixed salt collapses scrypt to a deterministic
  // function of ENCRYPTION_KEY and enables precomputation. The salt is public,
  // so we store it alongside the ciphertext.
  const salt = randomBytes(SALT_LENGTH)
  const key = deriveKey(secret, salt)
  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv(ALGORITHM, key, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  const result = Buffer.concat([salt, iv, authTag, encrypted])
  return V2_PREFIX + result.toString('base64')
}

export function decryptSecret(ciphertext: string): string {
  const secret = getSecret()

  if (ciphertext.startsWith(V2_PREFIX)) {
    const buffer = Buffer.from(ciphertext.slice(V2_PREFIX.length), 'base64')
    const salt = buffer.subarray(0, SALT_LENGTH)
    const iv = buffer.subarray(SALT_LENGTH, SALT_LENGTH + IV_LENGTH)
    const authTag = buffer.subarray(SALT_LENGTH + IV_LENGTH, SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH)
    const encrypted = buffer.subarray(SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH)
    const key = deriveKey(secret, salt)
    const decipher = createDecipheriv(ALGORITHM, key, iv)
    decipher.setAuthTag(authTag)
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8')
  }

  // Legacy v1 format (no prefix): static salt.
  const buffer = Buffer.from(ciphertext, 'base64')
  const iv = buffer.subarray(0, IV_LENGTH)
  const authTag = buffer.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH)
  const encrypted = buffer.subarray(IV_LENGTH + AUTH_TAG_LENGTH)
  const key = deriveKey(secret, LEGACY_SALT)
  const decipher = createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(authTag)
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8')
}
