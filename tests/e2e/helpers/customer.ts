/**
 * Teléfono único por corrida para los flujos que crean una ficha de clienta.
 *
 * POR QUÉ: `findOrCreateCustomerInTx` matchea la Customer por TELÉFONO
 * normalizado (no por nombre), así que un número fijo hace que dos corridas
 * compartan ficha. Eso trae dos problemas:
 *  1. Un retry de Playwright reusa la Customer del intento anterior, que
 *     conserva su nombre original → rompe los asserts sobre el nombre.
 *  2. Los workers en PARALELO crean la misma ficha a la vez. Antes del advisory
 *     lock (PR #88) esa carrera dejaba Customers duplicadas en la DB real: en
 *     prod quedaron 8 fichas con el teléfono fijo `+56912345678`, cada una con
 *     el nombre/email de una corrida distinta.
 *
 * Forma: `+569` + 8 dígitos = móvil chileno válido para `normalizePhone`
 * (11 dígitos que empiezan con 569 → se guarda tal cual). Los 8 dígitos son
 * AZAR PURO, no timestamp: dos workers que arrancan en el mismo milisegundo
 * obtendrían el mismo número si dependiera del reloj. Nadie lee este valor —
 * la trazabilidad por corrida ya la da el nombre, que sí lleva `Date.now()`.
 */
export function uniqueCustomerPhone(): string {
  const digits = String(Math.floor(Math.random() * 1e8)).padStart(8, '0')
  return `+569${digits}`
}
