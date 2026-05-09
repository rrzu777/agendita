import { prisma } from '@/lib/db/prisma'

export interface ResolvedTenant {
  businessId: string
  slug: string
  subdomain: string
  isCustomDomain: boolean
}

export async function resolveTenant(hostname: string): Promise<ResolvedTenant | null> {
  const appDomain = process.env.APP_DOMAIN || 'localhost:3000'
  
  // Remove port if present
  const cleanHostname = hostname.split(':')[0]
  const cleanAppDomain = appDomain.split(':')[0]
  
  // Check if it's the main domain
  if (cleanHostname === cleanAppDomain || cleanHostname === 'localhost') {
    return null
  }
  
  // Check for subdomain (e.g., mimosnails.agendita.com)
  if (cleanHostname.endsWith(`.${cleanAppDomain}`)) {
    const subdomain = cleanHostname.replace(`.${cleanAppDomain}`, '')
    
    const business = await prisma.business.findUnique({
      where: { subdomain },
      select: { id: true, slug: true, subdomain: true },
    })
    
    if (business) {
      return {
        businessId: business.id,
        slug: business.slug,
        subdomain: business.subdomain,
        isCustomDomain: false,
      }
    }
  }
  
  // Check for custom domain
  const business = await prisma.business.findUnique({
    where: { customDomain: cleanHostname },
    select: { id: true, slug: true, subdomain: true },
  })
  
  if (business) {
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
