import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { resolveTenant } from '@/lib/tenant/resolver'

export async function middleware(request: NextRequest) {
  const { pathname, hostname } = request.nextUrl
  
  // Skip middleware for static files and API routes
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/api') ||
    pathname.includes('.')
  ) {
    return NextResponse.next()
  }
  
  // Resolve tenant from hostname
  const tenant = await resolveTenant(hostname)
  
  // If no tenant and not on main domain, show 404
  if (!tenant && pathname !== '/') {
    // Could redirect to main domain or show 404
    return NextResponse.next()
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
