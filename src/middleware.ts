import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { resolveTenant } from '@/lib/tenant/resolver'

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl
  const rawHostname = request.headers.get('host') || request.nextUrl.hostname
  const hostname = rawHostname.split(':')[0]
  
  // Skip middleware for static files and API routes
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/api') ||
    pathname.includes('.')
  ) {
    return NextResponse.next()
  }
  
  // Resolve tenant from hostname
  let tenant = await resolveTenant(hostname)
  
  // Fallback for development: mock tenant for known subdomains
  if (!tenant && hostname.includes('mimosnails')) {
    tenant = {
      businessId: 'mock-business-1',
      slug: 'mimosnails',
      subdomain: 'mimosnails',
      isCustomDomain: false,
    }
  }
  
  // Add tenant info to headers for use in server components/actions
  const requestHeaders = new Headers(request.headers)
  if (tenant) {
    requestHeaders.set('x-business-id', tenant.businessId)
    requestHeaders.set('x-business-slug', tenant.slug)
    requestHeaders.set('x-business-subdomain', tenant.subdomain)
  }
  
  return NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  })
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
