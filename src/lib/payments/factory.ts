import { PaymentProvider } from './types'
import { mockPaymentProvider } from './mock-provider'
import { manualPaymentProvider } from './manual-provider'
import { mercadoPagoPaymentProvider } from './mercado-pago-provider'

export type ProviderName = 'mock' | 'manual' | 'mercado_pago' | 'webpay'

const VALID_PROVIDERS: ProviderName[] = ['mock', 'manual', 'mercado_pago', 'webpay']
const ONLINE_PROVIDERS: ProviderName[] = ['mercado_pago', 'webpay']
const IMPLEMENTED_PROVIDERS: ProviderName[] = ['mock', 'manual', 'mercado_pago']

function assertValidProviderName(name: string): asserts name is ProviderName {
  if (!VALID_PROVIDERS.includes(name as ProviderName)) {
    throw new Error(
      `Unknown payment provider: "${name}". Valid values: ${VALID_PROVIDERS.join(', ')}`,
    )
  }
}

export function getPaymentProvider(name: string): PaymentProvider {
  assertValidProviderName(name)

  switch (name as ProviderName) {
    case 'mock':
      return mockPaymentProvider
    case 'manual':
      return manualPaymentProvider
    case 'mercado_pago':
      return mercadoPagoPaymentProvider
    case 'webpay':
      throw new Error('Webpay provider not yet implemented.')
  }
}

export function getConfiguredPaymentProviderName(): ProviderName | null {
  const raw = process.env.PAYMENT_PROVIDER
  if (!raw) return null
  assertValidProviderName(raw)
  return raw
}

function isDevOrTest(): boolean {
  const env = process.env.NODE_ENV
  return env === 'development' || env === 'test'
}

/**
 * Safe check: never throws. Returns true when a provider is configured
 * and ready for online/public checkout.
 *
 * In dev/test without PAYMENT_PROVIDER, defaults to true because
 * getDefaultProvider() falls back to mock.
 */
export function isOnlinePaymentAvailable(): boolean {
  const raw = process.env.PAYMENT_PROVIDER

  // Explicitly set but invalid: misconfiguration, return false
  if (raw && !VALID_PROVIDERS.includes(raw as ProviderName)) {
    return false
  }

  const name = raw as ProviderName | null

  if (!name) {
    return isDevOrTest()
  }

  // Manual payments are dashboard-only, never online checkout
  if (name === 'manual') return false

  // Mock: only allowed in production with explicit override
  if (name === 'mock') {
    if (process.env.NODE_ENV === 'production') {
      return process.env.ALLOW_MOCK_PAYMENTS_IN_PRODUCTION === 'true'
    }
    return true
  }

  // Real online providers (mercado_pago, webpay)
  if (ONLINE_PROVIDERS.includes(name)) {
    if (!IMPLEMENTED_PROVIDERS.includes(name)) {
      return false
    }
    if (name === 'mercado_pago' && !process.env.MERCADO_PAGO_ACCESS_TOKEN) {
      return false
    }
    return true
  }

  return false
}

export type OnlinePaymentAvailability = {
  available: boolean
  provider: ProviderName | null
  reason?: string
  isMock: boolean
}

/**
 * Rich availability info for the UI. Never throws.
 */
export function resolveOnlinePaymentAvailability(): OnlinePaymentAvailability {
  const raw = process.env.PAYMENT_PROVIDER

  // Invalid provider name
  if (raw && !VALID_PROVIDERS.includes(raw as ProviderName)) {
    return {
      available: false,
      provider: null,
      reason: `PAYMENT_PROVIDER="${raw}" is invalid. Must be one of: ${VALID_PROVIDERS.join(', ')}.`,
      isMock: false,
    }
  }

  const name = raw as ProviderName | null

  if (!name) {
    if (isDevOrTest()) {
      return { available: true, provider: 'mock', isMock: true }
    }
    return {
      available: false,
      provider: null,
      reason: 'PAYMENT_PROVIDER is not configured.',
      isMock: false,
    }
  }

  if (name === 'manual') {
    return {
      available: false,
      provider: 'manual',
      reason: 'El proveedor configurado es manual, que no permite checkout público.',
      isMock: false,
    }
  }

  if (name === 'mock') {
    if (process.env.NODE_ENV === 'production') {
      if (process.env.ALLOW_MOCK_PAYMENTS_IN_PRODUCTION === 'true') {
        return { available: true, provider: 'mock', isMock: true }
      }
      return {
        available: false,
        provider: 'mock',
        reason: 'Mock payments are not allowed in production.',
        isMock: true,
      }
    }
    return { available: true, provider: 'mock', isMock: true }
  }

  if (ONLINE_PROVIDERS.includes(name)) {
    if (!IMPLEMENTED_PROVIDERS.includes(name)) {
      return {
        available: false,
        provider: name,
        reason: `El proveedor ${name} aún no está implementado.`,
        isMock: false,
      }
    }
    if (name === 'mercado_pago') {
      if (!process.env.MERCADO_PAGO_ACCESS_TOKEN) {
        return {
          available: false,
          provider: 'mercado_pago',
          reason: 'MERCADO_PAGO_ACCESS_TOKEN no está configurado.',
          isMock: false,
        }
      }
      if (
        process.env.NODE_ENV === 'production' &&
        !process.env.MERCADO_PAGO_WEBHOOK_SECRET
      ) {
        return {
          available: false,
          provider: 'mercado_pago',
          reason: 'MERCADO_PAGO_WEBHOOK_SECRET no está configurado (requerido en producción).',
          isMock: false,
        }
      }
    }
    return { available: true, provider: name, isMock: false }
  }

  return { available: false, provider: null, isMock: false }
}

/**
 * Returns a provider suitable for online/public checkout.
 * Throws if online payment is not available.
 */
export function getOnlinePaymentProvider(): PaymentProvider {
  if (!isOnlinePaymentAvailable()) {
    throw new Error(
      'Pago online no disponible. Contacta al negocio para coordinar el pago.',
    )
  }
  return getDefaultProvider()
}

/**
 * Returns the default payment provider based on environment and configuration.
 *
 * Rules:
 * - development/test: defaults to mock if PAYMENT_PROVIDER is not set.
 * - development/test: respects manual if explicitly configured.
 * - production: mock is forbidden unless ALLOW_MOCK_PAYMENTS_IN_PRODUCTION=true.
 * - production: PAYMENT_PROVIDER must be set.
 * - production: unimplemented providers fail with explicit error.
 */
export function getDefaultProvider(): PaymentProvider {
  const env = process.env.NODE_ENV
  const configured = getConfiguredPaymentProviderName()

  if (env === 'development' || env === 'test') {
    if (!configured) {
      return mockPaymentProvider
    }

    // Explicitly configured: respect any valid provider
    if (ONLINE_PROVIDERS.includes(configured) && !IMPLEMENTED_PROVIDERS.includes(configured)) {
      throw new Error(
        `${configured} provider not yet implemented. Use mock or manual for development.`,
      )
    }

    return getPaymentProvider(configured)
  }

  // Production
  if (!configured) {
    throw new Error(
      'PAYMENT_PROVIDER is not configured. Set it to mercado_pago or webpay for production. ' +
        'If you need to accept payments, configure a real provider.',
    )
  }

  if (configured === 'mock') {
    if (process.env.ALLOW_MOCK_PAYMENTS_IN_PRODUCTION === 'true') {
      return mockPaymentProvider
    }
    throw new Error(
      'PAYMENT_PROVIDER cannot be "mock" in production. ' +
        'Set ALLOW_MOCK_PAYMENTS_IN_PRODUCTION=true to override (unsafe - for testing only).',
    )
  }

  if (configured === 'manual') {
    return manualPaymentProvider
  }

  if (ONLINE_PROVIDERS.includes(configured)) {
    if (!IMPLEMENTED_PROVIDERS.includes(configured)) {
      throw new Error(
        `${configured} provider not yet implemented. ` +
          'Check the configuration or contact support to enable this provider.',
      )
    }
    return getPaymentProvider(configured)
  }

  throw new Error(`Unknown payment provider: ${configured}`)
}
