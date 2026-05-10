import { PaymentProvider } from './types'
import { mockPaymentProvider } from './mock-provider'
import { manualPaymentProvider } from './manual-provider'

export type ProviderName = 'mock' | 'manual' | 'mercado_pago' | 'webpay'

export function getPaymentProvider(name: ProviderName): PaymentProvider {
  switch (name) {
    case 'mock':
      return mockPaymentProvider
    case 'manual':
      return manualPaymentProvider
    case 'mercado_pago':
      // Will be implemented when credentials are available
      throw new Error('Mercado Pago provider not yet implemented. Please use mock or manual.')
    case 'webpay':
      // Will be implemented when credentials are available
      throw new Error('Webpay provider not yet implemented. Please use mock or manual.')
    default:
      throw new Error(`Unknown payment provider: ${name}`)
  }
}

export function getDefaultProvider(): PaymentProvider {
  const env = process.env.NODE_ENV
  if (env === 'development') {
    return mockPaymentProvider
  }
  // In production, would return mercado_pago or webpay
  return mockPaymentProvider
}
