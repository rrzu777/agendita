import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createMiddlewareClient } from './lib/auth/middleware'

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Skip middleware for static files, API routes, and auth pages
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/api') ||
    pathname.startsWith('/login') ||
    pathname.startsWith('/register') ||
    pathname.includes('.')
  ) {
    return NextResponse.next()
  }

  // Check auth for dashboard routes
  if (pathname.startsWith('/dashboard')) {
    const e2eEmail = request.headers.get('x-e2e-test-user-email')
    const e2eSecret = request.headers.get('x-e2e-auth-secret')

    // If both E2E headers are present, let the request through.
    // The server-side auth (user.ts) validates the actual bypass.
    if (!(e2eEmail && e2eSecret)) {
      const supabase = createMiddlewareClient(request)
      const { data: { session } } = await supabase.auth.getSession()

      if (!session) {
        const loginUrl = new URL('/login', request.url)
        return NextResponse.redirect(loginUrl)
      }
    }
  }

  // Extract subdomain from hostname for tenant resolution
  const rawHostname = request.headers.get('host') || request.nextUrl.hostname
  const hostname = rawHostname.split(':')[0].toLowerCase()
  const appDomain = (process.env.APP_DOMAIN || 'localhost')
    .replace(/^https?:\/\//, '')
    .replace(/\/$/, '')
    .split(':')[0]
    .toLowerCase()

  let subdomain: string | null = null
  if (hostname !== appDomain && hostname !== 'localhost') {
    if (hostname.endsWith(`.${appDomain}`)) {
      subdomain = hostname.replace(`.${appDomain}`, '')
      if (subdomain === 'www') {
        subdomain = null
      }
    } else if (hostname.endsWith('.localhost')) {
      subdomain = hostname.replace('.localhost', '')
      if (subdomain === 'www') {
        subdomain = null
      }
    } else if (!hostname.endsWith('.vercel.app')) {
      const labels = hostname.split('.')
      subdomain = labels.length >= 3 ? labels[0] : null
      if (subdomain === 'www') {
        subdomain = null
      }
    }
  }

  const requestHeaders = new Headers(request.headers)
  requestHeaders.delete('x-business-subdomain')

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
