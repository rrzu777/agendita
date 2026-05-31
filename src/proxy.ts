import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createMiddlewareClient, createMiddlewareAuthClient } from './lib/auth/middleware'
import { logger } from './lib/logger'

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Exchange Supabase auth codes directly in middleware
  const code = request.nextUrl.searchParams.get('code')
  if (code) {
    const redirectTo = '/reset-password'
    const response = NextResponse.redirect(new URL(redirectTo, request.url))
    const supabase = createMiddlewareAuthClient(request, response)
    await supabase.auth.exchangeCodeForSession(code)
    return response
  }

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
    // NEXT_PUBLIC_ vars are inlined at build time. If the secret was not
    // set during the build, the comparison always fails → bypass is dead code.
    // When set, only requests with the matching header pass through.
    const e2eConfiguredSecret = process.env.NEXT_PUBLIC_E2E_AUTH_BYPASS_SECRET
    const isE2EValid = e2eEmail && e2eSecret === e2eConfiguredSecret

    if (!isE2EValid) {
      const supabase = createMiddlewareClient(request)
      const { data: { session } } = await supabase.auth.getSession()

      if (!session) {
        logger.auth.failure('no-session', undefined, undefined)
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
