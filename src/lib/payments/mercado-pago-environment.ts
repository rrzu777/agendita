export type MercadoPagoEnvironment = 'sandbox' | 'production'

export function getMercadoPagoEnvironment(): MercadoPagoEnvironment | null {
  const environment = process.env.MERCADO_PAGO_ENVIRONMENT
  return environment === 'sandbox' || environment === 'production'
    ? environment
    : null
}

export function requireMercadoPagoEnvironment(): MercadoPagoEnvironment {
  const environment = getMercadoPagoEnvironment()
  if (!environment) {
    throw new Error('MERCADO_PAGO_ENVIRONMENT must be "sandbox" or "production".')
  }
  return environment
}
