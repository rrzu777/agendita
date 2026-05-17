import { headers as nextHeaders } from 'next/headers'
import { prisma } from '@/lib/db/prisma'

export interface ResolvedTenant {
  businessId: string
  slug: string
  subdomain: string
  isCustomDomain: boolean
}

function cleanDomain(value: string) {
  return value.replace(/^https?:\/\//, '').replace(/\/$/, '').split(':')[0].toLowerCase()
}

function getAppDomain() {
  return cleanDomain(process.env.APP_DOMAIN || process.env.NEXT_PUBLIC_APP_DOMAIN || 'localhost')
}

function getSubdomainFromHostname(hostname: string | null, appDomain = getAppDomain()) {
  if (!hostname) return null

  const cleanHostname = cleanDomain(hostname)
  const cleanAppDomain = cleanDomain(appDomain)

  if (
    cleanHostname === cleanAppDomain ||
    cleanHostname === 'localhost' ||
    cleanHostname === '127.0.0.1' ||
    cleanHostname === `www.${cleanAppDomain}`
  ) {
    return null
  }

  if (!cleanHostname.endsWith(`.${cleanAppDomain}`)) {
    return null
  }

  const subdomain = cleanHostname.replace(`.${cleanAppDomain}`, '')
  return subdomain && subdomain !== 'www' ? subdomain : null
}

function getSubdomainFromHeader(value: string | null) {
  if (!value) return null

  const subdomain = value.trim().toLowerCase()
  return /^[a-z0-9-]+$/.test(subdomain) && subdomain !== 'www' ? subdomain : null
}

function inferCustomDomainSubdomain(hostname: string | null) {
  if (!hostname) return null

  const cleanHostname = cleanDomain(hostname)

  if (
    cleanHostname === 'localhost' ||
    cleanHostname === '127.0.0.1' ||
    cleanHostname.endsWith('.vercel.app')
  ) {
    return null
  }

  const labels = cleanHostname.split('.')
  const firstLabel = labels[0]

  return labels.length >= 3 && firstLabel !== 'www' ? getSubdomainFromHeader(firstLabel) : null
}

export async function getCurrentBusinessFromSubdomain(subdomain: string | null | undefined): Promise<ResolvedTenant | null> {
  if (!subdomain) return null

  const business = await prisma.business.findUnique({
    where: { subdomain: subdomain.toLowerCase() },
    select: { id: true, slug: true, subdomain: true, isActive: true },
  })

  if (!business?.isActive) {
    return null
  }

  return {
    businessId: business.id,
    slug: business.slug,
    subdomain: business.subdomain,
    isCustomDomain: false,
  }
}

export async function getTenantFromRequest(requestHeaders?: Headers): Promise<ResolvedTenant | null> {
  const headerList = requestHeaders ?? await nextHeaders()
  const explicitSubdomain = getSubdomainFromHeader(headerList.get('x-business-subdomain'))
  const host = headerList.get('x-forwarded-host') || headerList.get('host')
  const subdomain = explicitSubdomain || getSubdomainFromHostname(host) || inferCustomDomainSubdomain(host)

  return getCurrentBusinessFromSubdomain(subdomain)
}

export async function resolveTenant(hostname: string): Promise<ResolvedTenant | null> {
  const subdomain = getSubdomainFromHostname(hostname)

  if (subdomain) {
    return getCurrentBusinessFromSubdomain(subdomain)
  }

  const cleanHostname = cleanDomain(hostname)
  const business = await prisma.business.findUnique({
    where: { customDomain: cleanHostname },
    select: { id: true, slug: true, subdomain: true, isActive: true },
  })

  if (business?.isActive) {
    return {
      businessId: business.id,
      slug: business.slug,
      subdomain: business.subdomain,
      isCustomDomain: true,
    }
  }
  
  return null
}

export function isDashboardPath(pathname: string): boolean {
  return pathname.startsWith('/dashboard')
}
