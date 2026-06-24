import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createMiddlewareAuthClient } from './lib/auth/middleware'
import { sanitizeNext } from './lib/auth/sanitize-next'

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Supabase falls back to the Site URL (the landing page, "/") when the
  // requested redirect target isn't allowlisted, stranding the auth code there
  // and looping on the landing page. Forward a stray code from the root to
  // /auth/callback so the session exchange still runs. Scoped to "/" so it never
  // touches API routes that legitimately use ?code= (e.g. the MP OAuth callback).
  if (pathname === '/' && request.nextUrl.searchParams.get('code')) {
    const url = new URL('/auth/callback', request.url)
    url.searchParams.set('code', request.nextUrl.searchParams.get('code')!)
    const next = request.nextUrl.searchParams.get('next')
    if (next) url.searchParams.set('next', next)
    return NextResponse.redirect(url)
  }

  if (pathname === '/auth/callback') {
    const code = request.nextUrl.searchParams.get('code')

    if (code) {
      const next = sanitizeNext(request.nextUrl.searchParams.get('next'))
      const response = NextResponse.redirect(new URL(next, request.url))
      const supabase = createMiddlewareAuthClient(request, response)
      const { error } = await supabase.auth.exchangeCodeForSession(code)

      if (error) {
        return NextResponse.redirect(new URL('/login?error=auth_callback', request.url))
      }

      return response
    }

    return NextResponse.redirect(new URL('/login?error=missing_code', request.url))
  }

  // Skip middleware for static files, API routes, and auth pages
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/api') ||
    pathname.startsWith('/login') ||
    pathname.startsWith('/register') ||
    pathname.startsWith('/forgot-password') ||
    pathname.startsWith('/reset-password') ||
    pathname.startsWith('/recover-business') ||
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
