import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import type { NextRequest, NextResponse } from 'next/server'
import { getAuthCookieDomain } from './cookie-domain'

// Shared cookie domain (e.g. ".agendita.cl") so auth + PKCE cookies span apex,
// www and tenant subdomains. undefined on localhost (host-only cookies).
const COOKIE_DOMAIN = getAuthCookieDomain()
const withDomain = (options: Record<string, unknown>) =>
  COOKIE_DOMAIN ? { ...options, domain: COOKIE_DOMAIN } : options

// Cliente para Server Components y Server Actions (Node.js runtime)
export async function createClient() {
  const cookieStore = await cookies()

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value
        },
        set(name: string, value: string, options: Record<string, unknown>) {
          try {
            cookieStore.set({ name, value, ...withDomain(options) })
          } catch {
            // Handle middleware context
          }
        },
        remove(name: string, options: Record<string, unknown>) {
          try {
            cookieStore.set({ name, value: '', ...withDomain(options) })
          } catch {
            // Handle middleware context
          }
        },
      },
    }
  )
}

// Cliente para Middleware (Edge Runtime)
export function createMiddlewareClient(request: NextRequest) {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return request.cookies.get(name)?.value
        },
        set(name: string, value: string, options: Record<string, unknown>) {
          request.cookies.set({ name, value, ...withDomain(options) })
        },
        remove(name: string, options: Record<string, unknown>) {
          request.cookies.set({ name, value: '', ...withDomain(options) })
        },
      },
    }
  )
}

// Cliente para intercambio de códigos de auth — escribe cookies directamente
// en la respuesta de redirección, asegurando que persistan correctamente.
export function createMiddlewareAuthClient(request: NextRequest, response: NextResponse) {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return request.cookies.get(name)?.value
        },
        set(name: string, value: string, options: Record<string, unknown>) {
          response.cookies.set(name, value, withDomain(options) as Record<string, string>)
        },
        remove(name: string, options: Record<string, unknown>) {
          response.cookies.set(name, '', { ...withDomain(options) as Record<string, string>, maxAge: 0 })
        },
      },
    }
  )
}
