import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const originalEnv = { ...process.env }

function setEnv(vars: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(vars)) {
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }
}

describe('oauth-state', () => {
  afterEach(() => {
    process.env = { ...originalEnv }
  })

  describe('signState', () => {
    it('throws when ENCRYPTION_KEY is not set', async () => {
      setEnv({ ENCRYPTION_KEY: undefined })
      const { signState } = await import('@/lib/payments/oauth-state')
      expect(() => signState('test-payload')).toThrow('ENCRYPTION_KEY')
    })

    it('returns a hex string when ENCRYPTION_KEY is set', async () => {
      setEnv({ ENCRYPTION_KEY: 'my-test-encryption-key-32bytes!' })
      const { signState } = await import('@/lib/payments/oauth-state')
      const sig = signState('biz-1:abc123:9999999999')
      expect(typeof sig).toBe('string')
      expect(sig.length).toBe(64) // SHA-256 hex = 64 chars
    })

    it('produces deterministic signatures for same payload', async () => {
      setEnv({ ENCRYPTION_KEY: 'consistent-key-for-testing--!' })
      const { signState } = await import('@/lib/payments/oauth-state')
      const sig1 = signState('same-payload')
      // Re-import to clear any cached state
      const { signState: signState2 } = await import('@/lib/payments/oauth-state')
      const sig2 = signState2('same-payload')
      expect(sig1).toBe(sig2)
    })

    it('produces different signatures for different payloads', async () => {
      setEnv({ ENCRYPTION_KEY: 'different-payload-key-test!' })
      const { signState } = await import('@/lib/payments/oauth-state')
      const sig1 = signState('payload-a')
      const sig2 = signState('payload-b')
      expect(sig1).not.toBe(sig2)
    })
  })

  describe('verifyStateSignature', () => {
    it('returns false when ENCRYPTION_KEY is not set', async () => {
      setEnv({ ENCRYPTION_KEY: undefined })
      const { verifyStateSignature } = await import('@/lib/payments/oauth-state')
      expect(verifyStateSignature('payload', 'any-signature')).toBe(false)
    })

    it('returns true for valid signature', async () => {
      setEnv({ ENCRYPTION_KEY: 'verify-test-key-32bytes-here!' })
      const { signState, verifyStateSignature } = await import('@/lib/payments/oauth-state')
      const payload = 'biz-1:state123:9999999999'
      const sig = signState(payload)
      expect(verifyStateSignature(payload, sig)).toBe(true)
    })

    it('returns false for invalid signature', async () => {
      setEnv({ ENCRYPTION_KEY: 'verify-test-key-32bytes-here!' })
      const { verifyStateSignature } = await import('@/lib/payments/oauth-state')
      expect(verifyStateSignature('payload', 'deadbeef'.repeat(8))).toBe(false)
    })

    it('returns false for tampered payload', async () => {
      setEnv({ ENCRYPTION_KEY: 'tamper-test-key-32bytes-now!' })
      const { signState, verifyStateSignature } = await import('@/lib/payments/oauth-state')
      const original = 'biz-1:state123:9999999999'
      const sig = signState(original)
      expect(verifyStateSignature('biz-2:state123:9999999999', sig)).toBe(false)
    })
  })
})
