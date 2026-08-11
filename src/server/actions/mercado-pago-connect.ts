'use server'

import { prisma } from '@/lib/db'
import { requireBusiness } from '@/lib/auth/server'
import { randomBytes } from 'crypto'
import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { action, UserError } from '@/lib/actions/result'
import { requireMercadoPagoEnvironment } from '@/lib/payments/mercado-pago-environment'
import { createMercadoPagoOAuthState, createPkcePair, MP_OAUTH_PKCE_COOKIE } from '@/lib/payments/mercado-pago-oauth'

const MP_AUTH_URL = 'https://auth.mercadopago.cl/authorization'

// OJO: iniciadores OAuth deliberadamente SIN action(): sus throws son invariantes
// de misconfig (inglés, server-only) y el caller <form action> no lee retorno.
// No migrar a UserError/ActionResult.
export async function startMercadoPagoConnect() {
  const { redirectUrl } = await initiateMercadoPagoOAuth()
  redirect(redirectUrl)
}

export async function initiateMercadoPagoOAuth(): Promise<{ redirectUrl: string }> {
  const { businessId } = await requireBusiness()
  const environment = requireMercadoPagoEnvironment()

  const clientId = process.env.MERCADO_PAGO_CLIENT_ID
  const redirectUri = process.env.MERCADO_PAGO_REDIRECT_URI

  if (!clientId || !redirectUri) {
    throw new Error(
      'Mercado Pago integration not configured. Set MERCADO_PAGO_CLIENT_ID and MERCADO_PAGO_REDIRECT_URI.',
    )
  }

  const nonce = randomBytes(32).toString('base64url')
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000)
  const { verifier, challenge } = createPkcePair()
  let state: string
  try {
    state = createMercadoPagoOAuthState({ businessId, environment, nonce, expiresAt })
    const cookieStore = await cookies()
    cookieStore.set(MP_OAUTH_PKCE_COOKIE, Buffer.from(JSON.stringify({ nonce, verifier })).toString('base64url'), {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/api/mercado-pago/callback',
      expires: expiresAt,
    })
  } catch {
    throw new Error('ENCRYPTION_KEY must be configured for Mercado Pago OAuth')
  }

  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    platform_id: 'mp',
    state,
    redirect_uri: redirectUri,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  })

  return { redirectUrl: `${MP_AUTH_URL}?${params.toString()}` }
}

async function _disconnectMercadoPagoConnection() {
  const { businessId } = await requireBusiness()
  const environment = requireMercadoPagoEnvironment()

  const account = await prisma.paymentAccount.findFirst({
    where: { businessId, provider: 'mercado_pago', environment },
  })

  if (!account) {
    // user-facing: shown verbatim by the disconnect button on failure
    throw new UserError('No hay cuenta de Mercado Pago conectada')
  }

  await prisma.paymentAccount.update({
    where: { id: account.id },
    data: {
      status: 'disconnected',
      disconnectedAt: new Date(),
    },
  })

  return { disconnected: true }
}

export const disconnectMercadoPagoConnection = action(_disconnectMercadoPagoConnection)

// Backward-compatible alias. Every export of a 'use server' module must EVALUATE
// to an async function — `action(...)` above returns one, so that `export const`
// is fine. This alias stays a declared `export async function` (not a re-exported
// const) purely for a stable name/back-compat.
export async function disconnectMercadoPago() {
  return disconnectMercadoPagoConnection()
}

export async function getPaymentAccountStatus() {
  const { businessId } = await requireBusiness()
  const environment = requireMercadoPagoEnvironment()

  const account = await prisma.paymentAccount.findFirst({
    where: { businessId, provider: 'mercado_pago', environment },
    select: {
      id: true,
      status: true,
      providerAccountId: true,
      connectedAt: true,
      disconnectedAt: true,
      expiresAt: true,
    },
  })

  return account
}
