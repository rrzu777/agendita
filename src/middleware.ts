import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl
  const rawHostname = request.headers.get('host') || request.nextUrl.hostname
  const hostname = rawHostname.split(':')[0]
  const appDomain = (process.env.APP_DOMAIN || 'localhost').split(':')[0]
  
  // Skip middleware for static files and API routes
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/api') ||
    pathname.includes('.')
  ) {
    return NextResponse.next()
  }
  
  // Extract subdomain from hostname
  // e.g., mimosnails.localhost:3000 -> mimosnails
  let subdomain: string | null = null
  if (hostname !== appDomain && hostname !== 'localhost') {
    if (hostname.endsWith(`.${appDomain}`)) {
      subdomain = hostname.replace(`.${appDomain}`, '')
    } else if (hostname.includes('.')) {
      // Custom domain or other subdomain pattern
      subdomain = hostname.split('.')[0]
    }
  }
  
  // Fallback for development
  if (!subdomain && hostname.includes('mimosnails')) {
    subdomain = 'mimosnails'
  }
  
  // Add tenant info to headers for use in server components/actions
  const requestHeaders = new Headers(request.headers)
  if (subdomain) {
    requestHeaders.set('x-business-subdomain', subdomain)
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
