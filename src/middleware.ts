import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createMiddlewareAuthClient } from './lib/auth/middleware'

export async function middleware(request: NextRequest) {
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
    pathname.startsWith('/forgot-password') ||
    pathname.startsWith('/reset-password') ||
    pathname.startsWith('/auth') ||
    pathname.includes('.')
  ) {
    return NextResponse.next()
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
