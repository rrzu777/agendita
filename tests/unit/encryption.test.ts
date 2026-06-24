import { describe, it, expect, beforeEach } from 'vitest'
import { createCipheriv, randomBytes, scryptSync } from 'crypto'

const KEY = 'test-encryption-key-32-bytes-long!!'

// Reproduces the pre-random-salt (v1) format so we can prove backward compat.
function legacyEncrypt(plaintext: string): string {
  const key = scryptSync(KEY, 'agendita-mp-encryption-v1', 32)
  const iv = randomBytes(16)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, tag, enc]).toString('base64')
}

describe('payment token encryption', () => {
  beforeEach(() => {
    process.env.ENCRYPTION_KEY = KEY
  })

  it('roundtrips encrypt -> decrypt and produces v2 ciphertext', async () => {
    const { encryptSecret, decryptSecret } = await import('@/lib/payments/encryption')
    const secret = 'APP_USR-super-secret-token'
    const enc = encryptSecret(secret)
    expect(enc.startsWith('v2:')).toBe(true)
    expect(enc).not.toContain(secret)
    expect(decryptSecret(enc)).toBe(secret)
  })

  it('uses a random per-record salt (two encryptions of the same value differ)', async () => {
    const { encryptSecret } = await import('@/lib/payments/encryption')
    expect(encryptSecret('same-token')).not.toBe(encryptSecret('same-token'))
  })

  it('still decrypts legacy v1 ciphertext (static salt, no prefix)', async () => {
    const { decryptSecret } = await import('@/lib/payments/encryption')
    expect(decryptSecret(legacyEncrypt('legacy-token-value'))).toBe('legacy-token-value')
  })

  it('throws when ENCRYPTION_KEY is missing', async () => {
    delete process.env.ENCRYPTION_KEY
    const { encryptSecret } = await import('@/lib/payments/encryption')
    expect(() => encryptSecret('x')).toThrow('ENCRYPTION_KEY')
  })
})
