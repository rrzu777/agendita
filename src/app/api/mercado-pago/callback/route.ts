import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { createClient } from '@/lib/auth/middleware'
import { getMercadoPagoEnvironment } from '@/lib/payments/mercado-pago-environment'
import {
  encryptOAuthTokenResponse,
  exchangeAuthorizationCode,
  MP_OAUTH_PKCE_COOKIE,
  verifyMercadoPagoOAuthState,
} from '@/lib/payments/mercado-pago-oauth'

function redirectWithResult(request: NextRequest, query: string) {
  const response = NextResponse.redirect(new URL(`/dashboard/settings/payments?${query}`, request.url))
  response.cookies.set(MP_OAUTH_PKCE_COOKIE, '', {
    httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax',
    path: '/api/mercado-pago/callback', maxAge: 0,
  })
  return response
}

function readPkceCookie(request: NextRequest): { nonce: string; verifier: string } | null {
  const raw = request.cookies.get(MP_OAUTH_PKCE_COOKIE)?.value
  if (!raw) return null
  try {
    const value = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as Record<string, unknown>
    return typeof value.nonce === 'string' && typeof value.verifier === 'string'
      ? { nonce: value.nonce, verifier: value.verifier }
      : null
  } catch {
    return null
  }
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const error = url.searchParams.get('error')

  if (error) {
    return redirectWithResult(request, 'error=authorization_denied')
  }

  if (!code || !state) {
    return redirectWithResult(request, 'error=invalid_callback')
  }

  const environment = getMercadoPagoEnvironment()
  const verifiedState = environment ? verifyMercadoPagoOAuthState(state, environment) : null
  const pkce = readPkceCookie(request)
  if (!verifiedState || !pkce || pkce.nonce !== verifiedState.nonce) {
    return redirectWithResult(request, 'error=invalid_state')
  }
  const { businessId } = verifiedState

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return redirectWithResult(request, 'error=not_authenticated')
  }

  const membership = await prisma.businessUser.findFirst({
    where: { businessId, userId: user.id },
    select: { role: true },
  })

  if (!membership || !['owner', 'admin'].includes(membership.role)) {
    return redirectWithResult(request, 'error=not_authorized')
  }

  const business = await prisma.business.findUnique({
    where: { id: businessId, isActive: true },
    select: { id: true },
  })

  if (!business) {
    return redirectWithResult(request, 'error=business_not_found')
  }

  const clientId = process.env.MERCADO_PAGO_CLIENT_ID
  const clientSecret = process.env.MERCADO_PAGO_CLIENT_SECRET
  const redirectUri = process.env.MERCADO_PAGO_REDIRECT_URI
  if (!clientId || !clientSecret || !redirectUri || !environment) {
    return redirectWithResult(request, 'error=mp_not_configured')
  }

  try {
    const tokenData = await exchangeAuthorizationCode({
      environment, clientId, clientSecret, redirectUri, code, codeVerifier: pkce.verifier,
    })
    const encrypted = encryptOAuthTokenResponse(tokenData)

    await prisma.paymentAccount.upsert({
      where: {
        businessId_provider_environment: {
          businessId,
          provider: 'mercado_pago',
          environment,
        },
      },
      create: {
        businessId,
        provider: 'mercado_pago',
        environment,
        ...encrypted,
        status: 'connected',
        connectedAt: new Date(),
      },
      update: {
        ...encrypted,
        status: 'connected',
        connectedAt: new Date(),
        disconnectedAt: null,
      },
    })

    return redirectWithResult(request, 'success=connected')
  } catch {
    console.error('[MP OAuth] Callback failed')
    return redirectWithResult(request, 'error=token_exchange_failed')
  }
}
