const ZERO_DECIMAL = new Set(['CLP', 'JPY', 'KRW', 'PYG', 'CLF'])

// Cache por currency: construir un Intl.NumberFormat cuesta ~32µs por llamada
// (vs ~0.3µs cacheado) y formatMoney corre en render paths con listas largas.
// Cardinalidad acotada: una currency por negocio.
const formatters = new Map<string, Intl.NumberFormat>()

function getFormatter(currency: string): Intl.NumberFormat {
  let formatter = formatters.get(currency)
  if (!formatter) {
    const fractionDigits = ZERO_DECIMAL.has(currency) ? 0 : 2
    formatter = new Intl.NumberFormat('es-CL', {
      style: 'currency',
      currency,
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
    })
    formatters.set(currency, formatter)
  }
  return formatter
}

/** Formatea un monto entero en la moneda del negocio. Currency-clean:
 *  usar SIEMPRE este helper en código nuevo de plata (nada de 'es-CL' hardcodeado).
 *  currency es requerida a propósito: el compilador obliga a decidir la moneda
 *  en cada sitio nuevo (plata del negocio → business.currency; plata de la
 *  plataforma → 'CLP' explícito, ver billing y admin).
 *  Excepción deliberada: las superficies de pago del dashboard usan
 *  formatManualPaymentMoney ("$1.000 CLP") de components/dashboard/manual-payment-utils. */
export function formatMoney(amount: number, currency: string): string {
  try {
    return getFormatter(currency).format(amount)
  } catch {
    return `$${amount.toLocaleString('es-CL')}`
  }
}
