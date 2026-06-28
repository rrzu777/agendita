const ZERO_DECIMAL = new Set(['CLP', 'JPY', 'KRW', 'PYG', 'CLF'])

/** Formatea un monto entero en la moneda del negocio. Currency-clean:
 *  usar SIEMPRE este helper en código nuevo de plata (nada de 'es-CL' hardcodeado). */
export function formatMoney(amount: number, currency = 'CLP'): string {
  const fractionDigits = ZERO_DECIMAL.has(currency) ? 0 : 2
  try {
    return new Intl.NumberFormat('es-CL', {
      style: 'currency',
      currency,
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
    }).format(amount)
  } catch {
    return `$${amount.toLocaleString('es-CL')}`
  }
}
