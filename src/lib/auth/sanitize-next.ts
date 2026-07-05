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
  if (next.startsWith('//')) return fallback
  return next
}
