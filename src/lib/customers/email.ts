/** Email utilizable para envío: no vacío y con forma mínima `algo@dominio.tld`.
 *  Validación laxa a propósito — el bounce real lo maneja Resend. Simétrico a
 *  isWhatsappablePhone en @/lib/customers/phone. */
export function isEmailable(email: string | null | undefined): boolean {
  if (!email) return false
  const trimmed = email.trim()
  const at = trimmed.indexOf('@')
  if (at <= 0) return false
  const domain = trimmed.slice(at + 1)
  return domain.includes('.') && !domain.startsWith('.') && !domain.endsWith('.')
}
