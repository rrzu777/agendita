import { NextResponse, type NextRequest } from 'next/server'
import { sanitizeNext } from '@/lib/auth/sanitize-next'

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url)
  // sanitizeNext blocks open redirects (e.g. ?next=//evil.com) — only
  // same-origin root-relative paths are allowed, everything else → /dashboard.
  const next = sanitizeNext(requestUrl.searchParams.get('next'))
  return NextResponse.redirect(new URL(next, request.url))
}
