/**
 * Normaliza un telefono para almacenamiento consistente y compatibilidad con WhatsApp.
 *
 * Estrategia:
 * - Elimina todos los caracteres no numericos (espacios, guiones, parentesis, etc.).
 * - Si el numero tiene 9 digitos y empieza con 9 (movil chileno sin codigo pais),
 *   antepone "56" => "569XXXXXXXX".
 * - Si el numero tiene 11 digitos y empieza con "569" (movil chileno completo),
 *   lo mantiene como "569XXXXXXXX".
 * - Otros formatos mantienen solo digitos tal cual.
 *
 * Para WhatsApp: https://wa.me/[telefono] (sin +, solo digitos).
 *
 * Ejemplos:
 *   "9 1234 5678"  -> "56912345678"
 *   "56912345678"  -> "56912345678"
 *   "+56912345678" -> "56912345678"
 *   "+56 9 1234 5678" -> "56912345678"
 */
export function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, '')

  if (digits.length === 9 && digits.startsWith('9')) {
    return `56${digits}`
  }

  if (digits.length === 11 && digits.startsWith('569')) {
    return digits
  }

  return digits
}
