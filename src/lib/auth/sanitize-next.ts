/**
 * Sanitize a post-auth `next` redirect target.
 *
 * Only same-origin, root-relative paths are allowed. Anything else (absolute
 * URLs, protocol-relative `//host`, bare hosts, empty) falls back to
 * `/dashboard`. This prevents open-redirect attacks via `?next=//evil.com`.
 *
 * Edge-safe: pure string logic, no Node APIs (used from middleware).
 */
export function sanitizeNext(next: string | null, fallback = '/dashboard'): string {
  if (!next) return fallback
  if (!next.startsWith('/')) return fallback
  // Protocol-relative (//evil.com) y backslash (/\evil.com): los browsers y
  // new URL() normalizan \ a / en schemes especiales, así que /\evil.com
  // termina siendo https://evil.com/ — ambos son open redirects.
  if (next.startsWith('//') || next.startsWith('/\\')) return fallback
  return next
}

/**
 * A qué login volver cuando el callback de auth falla. Las clientas entran por
 * /ingresar (superficies /mi y /tarjeta); las dueñas por /login. Sin esto, una
 * clienta con un error de OAuth aterriza en el login de dueñas (email+password),
 * que no le sirve para nada.
 *
 * Edge-safe: string puro (lo usa el middleware).
 */
export function authErrorRedirectPath(next: string | null, error: string): string {
  const safeNext = sanitizeNext(next)
  const isCustomerFlow =
    safeNext === '/mi' ||
    safeNext.startsWith('/mi/') ||
    safeNext.startsWith('/tarjeta/') ||
    safeNext.startsWith('/paquetes')
  if (isCustomerFlow) {
    return `/ingresar?error=${encodeURIComponent(error)}&next=${encodeURIComponent(safeNext)}`
  }
  return `/login?error=${encodeURIComponent(error)}`
}
