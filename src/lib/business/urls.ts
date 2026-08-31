import { normalizeAcquisition } from '@/lib/analytics/attribution'

type BusinessUrlInput = {
  slug: string
  subdomain: string | null
}

export type PublicSearchInput = URLSearchParams | Record<string, string | string[] | undefined>
/** Navigation allowlist; never forwards credentials, contact fields, arbitrary UTMs or a redirect target. */
export function publicAcquisitionSearch(input: PublicSearchInput): string {
  const get = (key: string) => {
    const value = input instanceof URLSearchParams ? input.getAll(key) : input[key]
    return Array.isArray(value) ? value.length === 1 ? value[0] : undefined : value
  }
  const result = new URLSearchParams()
  const ref = get('ref'), acq = get('acq'), source = get('utm_source'), medium = get('utm_medium'), campaign = get('utm_campaign')
  if (ref && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ref)) result.set('ref', ref)
  if (acq && /^[A-Za-z0-9_-]{22,64}$/.test(acq)) result.set('acq', acq)
  if (source && source.length <= 80) result.set('utm_source', normalizeAcquisition({ utmSource: source }).channel)
  if (medium && ['social', 'paid_social', 'organic', 'cpc', 'ppc', 'email', 'referral', 'messaging', 'qr'].includes(medium.toLowerCase())) result.set('utm_medium', medium.toLowerCase())
  if (campaign && /^[A-Za-z0-9_-]{1,128}$/.test(campaign)) result.set('utm_campaign', campaign)
  if (get('continuar') === '1') result.set('continuar', '1')
  return result.toString()
}
export function appendPublicAcquisitionSearch(path: string, input: PublicSearchInput): string {
  const search = publicAcquisitionSearch(input)
  return search ? `${path}${path.includes('?') ? '&' : '?'}${search}` : path
}
export function getBookingLoginUrl(slug: string, input: PublicSearchInput = {}): string {
  return `/ingresar?next=${encodeURIComponent(appendPublicAcquisitionSearch(`/ir/${slug}`, input))}`
}

function getConfiguredAppDomain() {
  const rawDomain =
    process.env.NEXT_PUBLIC_APP_DOMAIN ||
    process.env.APP_DOMAIN ||
    'localhost:3000'

  return rawDomain.replace(/^https?:\/\//, '').replace(/\/$/, '')
}

function getProtocol(host: string) {
  return host.startsWith('localhost') || host.endsWith('.localhost') || host.startsWith('127.0.0.1')
    ? 'http'
    : 'https'
}

export function getAppUrl(pathname = '') {
  const host = getConfiguredAppDomain()
  const cleanPath = pathname.startsWith('/') ? pathname : `/${pathname}`
  return `${getProtocol(host)}://${host}${cleanPath === '/' ? '' : cleanPath}`
}

export function getBusinessPublicUrl(business: BusinessUrlInput, pathname = '') {
  const host = getConfiguredAppDomain()

  if (!business.subdomain) {
    return `${getProtocol(host)}://${host}/b/${business.slug}${pathname}`
  }

  const cleanPath = pathname.startsWith('/') ? pathname : `/${pathname}`
  // Tenant subdomains live on the apex domain (e.g. tenant.agendita.cl). Strip a
  // leading "www." so the URL never becomes tenant.www.agendita.cl when the app
  // is hosted on the www host.
  const apexHost = host.replace(/^www\./, '')
  return `${getProtocol(host)}://${business.subdomain}.${apexHost}${cleanPath === '/' ? '' : cleanPath}`
}

/** URL de la página de confirmación de una reserva (`/book/confirmation?bookingId=`),
 *  colgando de la URL pública del negocio. Centraliza el string duplicado en
 *  bookings/payments. */
export function getBookingConfirmationUrl(business: BusinessUrlInput, bookingId: string): string {
  return `${getBusinessPublicUrl(business)}/book/confirmation?bookingId=${bookingId}`
}

/**
 * Path del `.ics` de una reserva. Relativo a propósito: el endpoint no es del
 * negocio sino de la app, así que sirve igual desde el apex que desde el
 * subdominio del tenant, y así el link de la pantalla no depende de en cuál de
 * los dos está parada la clienta.
 *
 * `?app=google` sobre el mismo path redirige a Google Calendar en vez de bajar
 * el archivo.
 */
export function getBookingCalendarPath(bookingId: string): string {
  return `/api/bookings/${bookingId}/calendar`
}

/** La misma URL, absoluta: la que va adentro del mail. */
export function getBookingCalendarUrl(bookingId: string): string {
  return getAppUrl(getBookingCalendarPath(bookingId))
}

/** URL de la página de confirmación de una compra de paquete
 *  (`/paquetes/confirmation?purchaseId=`), colgando de la URL pública del negocio. */
export function getPackageConfirmationUrl(business: BusinessUrlInput, purchaseId: string): string {
  return `${getBusinessPublicUrl(business)}/paquetes/confirmation?purchaseId=${purchaseId}`
}

/** URL del funnel público de reserva (/book). Con subdominio vive en el apex del
 *  tenant (`https://sub.apex/book`); sin subdominio usa el path `/book/{slug}`.
 *  `search` (sin '?') agrega la query string (ej. `ref=TOKEN`). */
export function getBookingFunnelUrl(business: BusinessUrlInput, search = '') {
  const host = getConfiguredAppDomain()
  const protocol = getProtocol(host)
  const query = search ? `?${search}` : ''

  if (!business.subdomain) {
    return `${protocol}://${host}/book/${business.slug}${query}`
  }

  const apexHost = host.replace(/^www\./, '')
  return `${protocol}://${business.subdomain}.${apexHost}/book${query}`
}
