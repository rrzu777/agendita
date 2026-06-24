/**
 * Cookie domain for auth cookies (session + PKCE code_verifier).
 *
 * Returns the registrable domain with a leading dot (e.g. ".agendita.cl") so the
 * cookie is shared across the apex, "www", and every tenant subdomain. Without
 * this, PKCE breaks when the code_verifier is set on one host (www) but the
 * /auth/callback exchange runs on another (apex) — the cookie isn't sent and the
 * exchange fails with error=auth_callback.
 *
 * Returns undefined on localhost / IPs so local dev keeps host-only cookies.
 * Edge-safe: reads NEXT_PUBLIC_APP_DOMAIN (inlined at build), no Node APIs.
 */
export function getAuthCookieDomain(): string | undefined {
  const raw = (process.env.NEXT_PUBLIC_APP_DOMAIN || process.env.APP_DOMAIN || '')
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '')
    .replace(/:\d+$/, '')
    .toLowerCase()

  if (!raw || raw === 'localhost' || raw.endsWith('.localhost') || /^\d{1,3}(\.\d{1,3}){3}$/.test(raw)) {
    return undefined
  }

  const labels = raw.split('.')
  const base = labels.length > 2 ? labels.slice(-2).join('.') : raw
  return `.${base}`
}
