import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest'

const mockPaymentAccountFindFirst = vi.fn()

vi.mock('@/lib/db', () => ({ prisma: { paymentAccount: { findFirst: mockPaymentAccountFindFirst } } }))
vi.mock('@/lib/payments/encryption', () => ({
  encryptSecret: vi.fn(),
  decryptSecret: vi.fn(),
}))
vi.mock('@prisma/client', () => ({
  PaymentAccountStatus: { connected: 'connected', expired: 'expired', disconnected: 'disconnected', pending: 'pending', error: 'error' },
}))

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

afterEach(() => {
  process.env = { ...originalEnv }
  mockPaymentAccountFindFirst.mockReset()
  vi.resetModules()
})

beforeEach(() => {
  mockPaymentAccountFindFirst.mockReset()
})

describe('payment factory', () => {
  describe('getPaymentProvider', () => {
    it('returns mock provider', async () => {
      setEnv({ NODE_ENV: 'development' })
      const { getPaymentProvider } = await import('@/lib/payments/factory')
      const provider = getPaymentProvider('mock')
      expect(provider.name).toBe('mock')
    })

    it('returns manual provider', async () => {
      setEnv({ NODE_ENV: 'development' })
      const { getPaymentProvider } = await import('@/lib/payments/factory')
      const provider = getPaymentProvider('manual')
      expect(provider.name).toBe('manual')
    })

    it('returns mercado_pago provider', async () => {
      setEnv({ NODE_ENV: 'development' })
      const { getPaymentProvider } = await import('@/lib/payments/factory')
      const provider = getPaymentProvider('mercado_pago')
      expect(provider.name).toBe('mercado_pago')
    })

    it('throws for webpay (not implemented)', async () => {
      setEnv({ NODE_ENV: 'development' })
      const { getPaymentProvider } = await import('@/lib/payments/factory')
      expect(() => getPaymentProvider('webpay')).toThrow(/not yet implemented/)
    })

    it('throws for unknown provider', async () => {
      setEnv({ NODE_ENV: 'development' })
      const { getPaymentProvider } = await import('@/lib/payments/factory')
      expect(() => getPaymentProvider('stripe')).toThrow(/Unknown payment provider/)
    })
  })

  describe('getConfiguredPaymentProviderName', () => {
    it('returns null when PAYMENT_PROVIDER is not set', async () => {
      setEnv({ NODE_ENV: 'development', PAYMENT_PROVIDER: undefined })
      const { getConfiguredPaymentProviderName } = await import('@/lib/payments/factory')
      expect(getConfiguredPaymentProviderName()).toBeNull()
    })

    it('returns the configured provider name', async () => {
      setEnv({ NODE_ENV: 'development', PAYMENT_PROVIDER: 'manual' })
      const { getConfiguredPaymentProviderName } = await import('@/lib/payments/factory')
      expect(getConfiguredPaymentProviderName()).toBe('manual')
    })

    it('throws for invalid provider name', async () => {
      setEnv({ NODE_ENV: 'development', PAYMENT_PROVIDER: 'stripe' })
      const { getConfiguredPaymentProviderName } = await import('@/lib/payments/factory')
      expect(() => getConfiguredPaymentProviderName()).toThrow(/Unknown payment provider/)
    })
  })

  describe('isOnlinePaymentAvailable', () => {
    // Gap 1: dev/test without PAYMENT_PROVIDER should be true (mock fallback)
    it('returns true in development without PAYMENT_PROVIDER (mock fallback)', async () => {
      setEnv({ NODE_ENV: 'development', PAYMENT_PROVIDER: undefined })
      const { isOnlinePaymentAvailable } = await import('@/lib/payments/factory')
      expect(isOnlinePaymentAvailable()).toBe(true)
    })

    it('returns true in test without PAYMENT_PROVIDER (mock fallback)', async () => {
      setEnv({ NODE_ENV: 'test', PAYMENT_PROVIDER: undefined })
      const { isOnlinePaymentAvailable } = await import('@/lib/payments/factory')
      expect(isOnlinePaymentAvailable()).toBe(true)
    })

    it('returns false in production without PAYMENT_PROVIDER', async () => {
      setEnv({ NODE_ENV: 'production', PAYMENT_PROVIDER: undefined })
      const { isOnlinePaymentAvailable } = await import('@/lib/payments/factory')
      expect(isOnlinePaymentAvailable()).toBe(false)
    })

    // Gap 2: invalid PAYMENT_PROVIDER should not throw, return false
    it('returns false for invalid PAYMENT_PROVIDER (no throw)', async () => {
      setEnv({ NODE_ENV: 'development', PAYMENT_PROVIDER: 'stripe' })
      const { isOnlinePaymentAvailable } = await import('@/lib/payments/factory')
      expect(() => isOnlinePaymentAvailable()).not.toThrow()
      expect(isOnlinePaymentAvailable()).toBe(false)
    })

    it('returns false when PAYMENT_PROVIDER is manual', async () => {
      setEnv({ NODE_ENV: 'development', PAYMENT_PROVIDER: 'manual' })
      const { isOnlinePaymentAvailable } = await import('@/lib/payments/factory')
      expect(isOnlinePaymentAvailable()).toBe(false)
    })

    it('returns true for mock in development', async () => {
      setEnv({ NODE_ENV: 'development', PAYMENT_PROVIDER: 'mock' })
      const { isOnlinePaymentAvailable } = await import('@/lib/payments/factory')
      expect(isOnlinePaymentAvailable()).toBe(true)
    })

    it('returns true for mock in test', async () => {
      setEnv({ NODE_ENV: 'test', PAYMENT_PROVIDER: 'mock' })
      const { isOnlinePaymentAvailable } = await import('@/lib/payments/factory')
      expect(isOnlinePaymentAvailable()).toBe(true)
    })

    it('returns false for mock in production without override', async () => {
      setEnv({ NODE_ENV: 'production', PAYMENT_PROVIDER: 'mock' })
      const { isOnlinePaymentAvailable } = await import('@/lib/payments/factory')
      expect(isOnlinePaymentAvailable()).toBe(false)
    })

    it('returns true for mock in production with ALLOW_MOCK_PAYMENTS_IN_PRODUCTION=true', async () => {
      setEnv({
        NODE_ENV: 'production',
        PAYMENT_PROVIDER: 'mock',
        ALLOW_MOCK_PAYMENTS_IN_PRODUCTION: 'true',
      })
      const { isOnlinePaymentAvailable } = await import('@/lib/payments/factory')
      expect(isOnlinePaymentAvailable()).toBe(true)
    })

    it('returns false for mock in production with ALLOW_MOCK_PAYMENTS_IN_PRODUCTION=false', async () => {
      setEnv({
        NODE_ENV: 'production',
        PAYMENT_PROVIDER: 'mock',
        ALLOW_MOCK_PAYMENTS_IN_PRODUCTION: 'false',
      })
      const { isOnlinePaymentAvailable } = await import('@/lib/payments/factory')
      expect(isOnlinePaymentAvailable()).toBe(false)
    })

    it('returns false for mercado_pago without MERCADO_PAGO_ACCESS_TOKEN', async () => {
      setEnv({ NODE_ENV: 'production', PAYMENT_PROVIDER: 'mercado_pago', MERCADO_PAGO_ACCESS_TOKEN: undefined })
      const { isOnlinePaymentAvailable } = await import('@/lib/payments/factory')
      expect(isOnlinePaymentAvailable()).toBe(false)
    })

    it('returns true for mercado_pago with MERCADO_PAGO_ACCESS_TOKEN in production', async () => {
      setEnv({
        NODE_ENV: 'production',
        PAYMENT_PROVIDER: 'mercado_pago',
        MERCADO_PAGO_ACCESS_TOKEN: 'test-token',
        MERCADO_PAGO_WEBHOOK_SECRET: 'test-secret',
      })
      const { isOnlinePaymentAvailable } = await import('@/lib/payments/factory')
      expect(isOnlinePaymentAvailable()).toBe(true)
    })

    it('returns true for mercado_pago with token in dev', async () => {
      setEnv({
        NODE_ENV: 'development',
        PAYMENT_PROVIDER: 'mercado_pago',
        MERCADO_PAGO_ACCESS_TOKEN: 'test-token',
      })
      const { isOnlinePaymentAvailable } = await import('@/lib/payments/factory')
      expect(isOnlinePaymentAvailable()).toBe(true)
    })

    it('returns false for webpay (not implemented)', async () => {
      setEnv({ NODE_ENV: 'production', PAYMENT_PROVIDER: 'webpay' })
      const { isOnlinePaymentAvailable } = await import('@/lib/payments/factory')
      expect(isOnlinePaymentAvailable()).toBe(false)
    })
  })

  describe('resolveOnlinePaymentAvailability', () => {
    it('dev without PAYMENT_PROVIDER: available=true, provider=mock, isMock=true', async () => {
      setEnv({ NODE_ENV: 'development', PAYMENT_PROVIDER: undefined })
      const { resolveOnlinePaymentAvailability } = await import('@/lib/payments/factory')
      const result = resolveOnlinePaymentAvailability()
      expect(result.available).toBe(true)
      expect(result.provider).toBe('mock')
      expect(result.isMock).toBe(true)
      expect(result.reason).toBeUndefined()
    })

    it('test without PAYMENT_PROVIDER: available=true, provider=mock, isMock=true', async () => {
      setEnv({ NODE_ENV: 'test', PAYMENT_PROVIDER: undefined })
      const { resolveOnlinePaymentAvailability } = await import('@/lib/payments/factory')
      const result = resolveOnlinePaymentAvailability()
      expect(result.available).toBe(true)
      expect(result.provider).toBe('mock')
      expect(result.isMock).toBe(true)
    })

    it('production without PAYMENT_PROVIDER: available=false with reason', async () => {
      setEnv({ NODE_ENV: 'production', PAYMENT_PROVIDER: undefined })
      const { resolveOnlinePaymentAvailability } = await import('@/lib/payments/factory')
      const result = resolveOnlinePaymentAvailability()
      expect(result.available).toBe(false)
      expect(result.provider).toBeNull()
      expect(result.isMock).toBe(false)
      expect(result.reason).toContain('not configured')
    })

    it('invalid PAYMENT_PROVIDER: available=false with reason, no throw', async () => {
      setEnv({ NODE_ENV: 'production', PAYMENT_PROVIDER: 'stripe' })
      const { resolveOnlinePaymentAvailability } = await import('@/lib/payments/factory')
      expect(() => resolveOnlinePaymentAvailability()).not.toThrow()
      const result = resolveOnlinePaymentAvailability()
      expect(result.available).toBe(false)
      expect(result.provider).toBeNull()
      expect(result.isMock).toBe(false)
      expect(result.reason).toContain('invalid')
      expect(result.reason).toContain('stripe')
    })

    it('PAYMENT_PROVIDER=manual: available=false', async () => {
      setEnv({ NODE_ENV: 'production', PAYMENT_PROVIDER: 'manual' })
      const { resolveOnlinePaymentAvailability } = await import('@/lib/payments/factory')
      const result = resolveOnlinePaymentAvailability()
      expect(result.available).toBe(false)
      expect(result.provider).toBe('manual')
      expect(result.isMock).toBe(false)
    })

    it('PAYMENT_PROVIDER=mock in dev: available=true, isMock=true', async () => {
      setEnv({ NODE_ENV: 'development', PAYMENT_PROVIDER: 'mock' })
      const { resolveOnlinePaymentAvailability } = await import('@/lib/payments/factory')
      const result = resolveOnlinePaymentAvailability()
      expect(result.available).toBe(true)
      expect(result.provider).toBe('mock')
      expect(result.isMock).toBe(true)
    })

    it('PAYMENT_PROVIDER=mock in production without override: available=false, isMock=true', async () => {
      setEnv({ NODE_ENV: 'production', PAYMENT_PROVIDER: 'mock' })
      const { resolveOnlinePaymentAvailability } = await import('@/lib/payments/factory')
      const result = resolveOnlinePaymentAvailability()
      expect(result.available).toBe(false)
      expect(result.provider).toBe('mock')
      expect(result.isMock).toBe(true)
      expect(result.reason).toContain('not allowed in production')
    })

    it('PAYMENT_PROVIDER=mock in production with override: available=true', async () => {
      setEnv({
        NODE_ENV: 'production',
        PAYMENT_PROVIDER: 'mock',
        ALLOW_MOCK_PAYMENTS_IN_PRODUCTION: 'true',
      })
      const { resolveOnlinePaymentAvailability } = await import('@/lib/payments/factory')
      const result = resolveOnlinePaymentAvailability()
      expect(result.available).toBe(true)
      expect(result.provider).toBe('mock')
      expect(result.isMock).toBe(true)
    })

    it('PAYMENT_PROVIDER=mercado_pago without token: available=false with reason', async () => {
      setEnv({ NODE_ENV: 'production', PAYMENT_PROVIDER: 'mercado_pago', MERCADO_PAGO_ACCESS_TOKEN: undefined })
      const { resolveOnlinePaymentAvailability } = await import('@/lib/payments/factory')
      const result = resolveOnlinePaymentAvailability()
      expect(result.available).toBe(false)
      expect(result.provider).toBe('mercado_pago')
      expect(result.isMock).toBe(false)
      expect(result.reason).toContain('ACCESS_TOKEN')
    })

    it('PAYMENT_PROVIDER=mercado_pago in production without webhook secret: available=false', async () => {
      setEnv({
        NODE_ENV: 'production',
        PAYMENT_PROVIDER: 'mercado_pago',
        MERCADO_PAGO_ACCESS_TOKEN: 'test-token',
        MERCADO_PAGO_WEBHOOK_SECRET: undefined,
      })
      const { resolveOnlinePaymentAvailability } = await import('@/lib/payments/factory')
      const result = resolveOnlinePaymentAvailability()
      expect(result.available).toBe(false)
      expect(result.reason).toContain('WEBHOOK_SECRET')
    })

    it('PAYMENT_PROVIDER=mercado_pago with token and secret: available=true', async () => {
      setEnv({
        NODE_ENV: 'production',
        PAYMENT_PROVIDER: 'mercado_pago',
        MERCADO_PAGO_ACCESS_TOKEN: 'test-token',
        MERCADO_PAGO_WEBHOOK_SECRET: 'test-secret',
      })
      const { resolveOnlinePaymentAvailability } = await import('@/lib/payments/factory')
      const result = resolveOnlinePaymentAvailability()
      expect(result.available).toBe(true)
      expect(result.provider).toBe('mercado_pago')
      expect(result.isMock).toBe(false)
    })

    it('PAYMENT_PROVIDER=webpay: available=false (not implemented)', async () => {
      setEnv({ NODE_ENV: 'production', PAYMENT_PROVIDER: 'webpay' })
      const { resolveOnlinePaymentAvailability } = await import('@/lib/payments/factory')
      const result = resolveOnlinePaymentAvailability()
      expect(result.available).toBe(false)
      expect(result.provider).toBe('webpay')
      expect(result.isMock).toBe(false)
      expect(result.reason).toContain('no está implementado')
    })
  })

  describe('getOnlinePaymentProvider', () => {
    it('throws when online payment is not available', async () => {
      setEnv({ NODE_ENV: 'production', PAYMENT_PROVIDER: 'manual' })
      const { getOnlinePaymentProvider } = await import('@/lib/payments/factory')
      expect(() => getOnlinePaymentProvider()).toThrow(
        /Pago online no disponible/,
      )
    })

    it('returns mock provider when online payment is available in dev', async () => {
      setEnv({ NODE_ENV: 'development', PAYMENT_PROVIDER: 'mock' })
      const { getOnlinePaymentProvider } = await import('@/lib/payments/factory')
      const provider = getOnlinePaymentProvider()
      expect(provider.name).toBe('mock')
    })

    it('returns mock provider when online payment is available in dev without config', async () => {
      setEnv({ NODE_ENV: 'development', PAYMENT_PROVIDER: undefined })
      const { getOnlinePaymentProvider } = await import('@/lib/payments/factory')
      const provider = getOnlinePaymentProvider()
      expect(provider.name).toBe('mock')
    })

    it('returns mercado_pago provider when online payment is available', async () => {
      setEnv({
        NODE_ENV: 'development',
        PAYMENT_PROVIDER: 'mercado_pago',
        MERCADO_PAGO_ACCESS_TOKEN: 'test-token',
      })
      const { getOnlinePaymentProvider } = await import('@/lib/payments/factory')
      const provider = getOnlinePaymentProvider()
      expect(provider.name).toBe('mercado_pago')
    })

    it('throws when mercado_pago configured without token', async () => {
      setEnv({
        NODE_ENV: 'development',
        PAYMENT_PROVIDER: 'mercado_pago',
        MERCADO_PAGO_ACCESS_TOKEN: undefined,
      })
      const { getOnlinePaymentProvider } = await import('@/lib/payments/factory')
      expect(() => getOnlinePaymentProvider()).toThrow(
        /Pago online no disponible/,
      )
    })
  })

  describe('getDefaultProvider', () => {
    it('returns mock in development when not configured', async () => {
      setEnv({ NODE_ENV: 'development', PAYMENT_PROVIDER: undefined })
      const { getDefaultProvider } = await import('@/lib/payments/factory')
      expect(getDefaultProvider().name).toBe('mock')
    })

    it('returns mock in test when not configured', async () => {
      setEnv({ NODE_ENV: 'test', PAYMENT_PROVIDER: undefined })
      const { getDefaultProvider } = await import('@/lib/payments/factory')
      expect(getDefaultProvider().name).toBe('mock')
    })

    it('returns mock in development when PAYMENT_PROVIDER=mock', async () => {
      setEnv({ NODE_ENV: 'development', PAYMENT_PROVIDER: 'mock' })
      const { getDefaultProvider } = await import('@/lib/payments/factory')
      expect(getDefaultProvider().name).toBe('mock')
    })

    it('respects manual in development when explicitly configured', async () => {
      setEnv({ NODE_ENV: 'development', PAYMENT_PROVIDER: 'manual' })
      const { getDefaultProvider } = await import('@/lib/payments/factory')
      expect(getDefaultProvider().name).toBe('manual')
    })

    it('throws in production when PAYMENT_PROVIDER is not set', async () => {
      setEnv({ NODE_ENV: 'production', PAYMENT_PROVIDER: undefined })
      const { getDefaultProvider } = await import('@/lib/payments/factory')
      expect(() => getDefaultProvider()).toThrow(/PAYMENT_PROVIDER is not configured/)
    })

    it('throws in production when PAYMENT_PROVIDER=mock without override', async () => {
      setEnv({ NODE_ENV: 'production', PAYMENT_PROVIDER: 'mock' })
      const { getDefaultProvider } = await import('@/lib/payments/factory')
      expect(() => getDefaultProvider()).toThrow(/cannot be "mock" in production/)
    })

    it('returns mock in production when ALLOW_MOCK_PAYMENTS_IN_PRODUCTION=true', async () => {
      setEnv({
        NODE_ENV: 'production',
        PAYMENT_PROVIDER: 'mock',
        ALLOW_MOCK_PAYMENTS_IN_PRODUCTION: 'true',
      })
      const { getDefaultProvider } = await import('@/lib/payments/factory')
      expect(getDefaultProvider().name).toBe('mock')
    })

    it('returns manual in production when configured', async () => {
      setEnv({ NODE_ENV: 'production', PAYMENT_PROVIDER: 'manual' })
      const { getDefaultProvider } = await import('@/lib/payments/factory')
      expect(getDefaultProvider().name).toBe('manual')
    })

    it('returns mercado_pago provider in production when configured', async () => {
      setEnv({
        NODE_ENV: 'production',
        PAYMENT_PROVIDER: 'mercado_pago',
        MERCADO_PAGO_ACCESS_TOKEN: 'test-token',
      })
      const { getDefaultProvider } = await import('@/lib/payments/factory')
      expect(getDefaultProvider().name).toBe('mercado_pago')
    })

    it('returns mercado_pago provider in development when configured', async () => {
      setEnv({
        NODE_ENV: 'development',
        PAYMENT_PROVIDER: 'mercado_pago',
        MERCADO_PAGO_ACCESS_TOKEN: 'test-token',
      })
      const { getDefaultProvider } = await import('@/lib/payments/factory')
      expect(getDefaultProvider().name).toBe('mercado_pago')
    })

    it('throws for webpay in production (not implemented)', async () => {
      setEnv({ NODE_ENV: 'production', PAYMENT_PROVIDER: 'webpay' })
      const { getDefaultProvider } = await import('@/lib/payments/factory')
      expect(() => getDefaultProvider()).toThrow(/not yet implemented/)
    })

    it('returns mercado_pago provider in development when configured (already covered above)', async () => {
      setEnv({
        NODE_ENV: 'development',
        PAYMENT_PROVIDER: 'mercado_pago',
        MERCADO_PAGO_ACCESS_TOKEN: 'test-token',
      })
      const { getDefaultProvider } = await import('@/lib/payments/factory')
      expect(getDefaultProvider().name).toBe('mercado_pago')
    })

    it('throws for unknown provider in development', async () => {
      setEnv({ NODE_ENV: 'development', PAYMENT_PROVIDER: 'stripe' })
      const { getDefaultProvider } = await import('@/lib/payments/factory')
      expect(() => getDefaultProvider()).toThrow(/Unknown payment provider/)
    })
  })

  describe('resolveOnlinePaymentAvailabilityForBusiness', () => {
    const connectedAccount = { status: 'connected' as const, provider: 'mercado_pago' }
    const expiredAccount = { status: 'expired' as const, provider: 'mercado_pago' }

    it('PAYMENT_PROVIDER=manual returns unavailable even with connected PaymentAccount', async () => {
      setEnv({ NODE_ENV: 'development', PAYMENT_PROVIDER: 'manual' })
      mockPaymentAccountFindFirst.mockResolvedValue(connectedAccount)
      const { resolveOnlinePaymentAvailabilityForBusiness } = await import('@/lib/payments/factory')
      const result = await resolveOnlinePaymentAvailabilityForBusiness('biz-1')
      expect(result.available).toBe(false)
      expect(result.provider).toBeNull()
    })

    it('PAYMENT_PROVIDER=mock returns unavailable even with connected PaymentAccount', async () => {
      setEnv({ NODE_ENV: 'development', PAYMENT_PROVIDER: 'mock' })
      mockPaymentAccountFindFirst.mockResolvedValue(connectedAccount)
      const { resolveOnlinePaymentAvailabilityForBusiness } = await import('@/lib/payments/factory')
      const result = await resolveOnlinePaymentAvailabilityForBusiness('biz-1')
      expect(result.available).toBe(false)
      expect(result.provider).toBeNull()
    })

    it('PAYMENT_PROVIDER=webpay returns unavailable even with connected PaymentAccount', async () => {
      setEnv({ NODE_ENV: 'development', PAYMENT_PROVIDER: 'webpay' })
      mockPaymentAccountFindFirst.mockResolvedValue(connectedAccount)
      const { resolveOnlinePaymentAvailabilityForBusiness } = await import('@/lib/payments/factory')
      const result = await resolveOnlinePaymentAvailabilityForBusiness('biz-1')
      expect(result.available).toBe(false)
      expect(result.provider).toBeNull()
    })

    it('PAYMENT_PROVIDER=mercado_pago + PaymentAccount connected => available true', async () => {
      setEnv({ NODE_ENV: 'development', PAYMENT_PROVIDER: 'mercado_pago', MERCADO_PAGO_ACCESS_TOKEN: 'tok' })
      mockPaymentAccountFindFirst.mockResolvedValue(connectedAccount)
      const { resolveOnlinePaymentAvailabilityForBusiness } = await import('@/lib/payments/factory')
      const result = await resolveOnlinePaymentAvailabilityForBusiness('biz-1')
      expect(result.available).toBe(true)
      expect(result.provider).toBe('mercado_pago')
      expect(result.isMock).toBe(false)
    })

    it('no PAYMENT_PROVIDER + OAuth full + PaymentAccount connected => available true', async () => {
      setEnv({
        NODE_ENV: 'development',
        PAYMENT_PROVIDER: undefined,
        MERCADO_PAGO_CLIENT_ID: 'client',
        MERCADO_PAGO_CLIENT_SECRET: 'secret',
        MERCADO_PAGO_REDIRECT_URI: 'https://app.agendita.com/callback',
      })
      mockPaymentAccountFindFirst.mockResolvedValue(connectedAccount)
      const { resolveOnlinePaymentAvailabilityForBusiness } = await import('@/lib/payments/factory')
      const result = await resolveOnlinePaymentAvailabilityForBusiness('biz-1')
      expect(result.available).toBe(true)
      expect(result.provider).toBe('mercado_pago')
    })

    it('no PAYMENT_PROVIDER + no OAuth => unavailable', async () => {
      setEnv({ NODE_ENV: 'development', PAYMENT_PROVIDER: undefined })
      const { resolveOnlinePaymentAvailabilityForBusiness } = await import('@/lib/payments/factory')
      const result = await resolveOnlinePaymentAvailabilityForBusiness('biz-1')
      expect(result.available).toBe(false)
      expect(result.provider).toBeNull()
    })

    it('PaymentAccount expired => unavailable', async () => {
      setEnv({ NODE_ENV: 'development', PAYMENT_PROVIDER: 'mercado_pago', MERCADO_PAGO_ACCESS_TOKEN: 'tok' })
      mockPaymentAccountFindFirst.mockResolvedValue(expiredAccount)
      const { resolveOnlinePaymentAvailabilityForBusiness } = await import('@/lib/payments/factory')
      const result = await resolveOnlinePaymentAvailabilityForBusiness('biz-1')
      expect(result.available).toBe(false)
      expect(result.provider).toBe('mercado_pago')
    })

    it('no PaymentAccount => unavailable', async () => {
      setEnv({ NODE_ENV: 'development', PAYMENT_PROVIDER: 'mercado_pago', MERCADO_PAGO_ACCESS_TOKEN: 'tok' })
      mockPaymentAccountFindFirst.mockResolvedValue(null)
      const { resolveOnlinePaymentAvailabilityForBusiness } = await import('@/lib/payments/factory')
      const result = await resolveOnlinePaymentAvailabilityForBusiness('biz-1')
      expect(result.available).toBe(false)
      expect(result.provider).toBeNull()
    })
  })
})
