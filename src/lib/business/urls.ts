type BusinessUrlInput = {
  slug: string
  subdomain: string | null
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
