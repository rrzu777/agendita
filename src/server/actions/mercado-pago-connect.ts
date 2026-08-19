'use server'

import { prisma } from '@/lib/db'
import { requireBusinessRole } from '@/lib/auth/server'
import { randomBytes } from 'crypto'
import { redirect } from 'next/navigation'
import { action, UserError } from '@/lib/actions/result'
import { validateE2EHeaders } from '@/lib/auth/e2e-bypass'
import { requireMercadoPagoEnvironment } from '@/lib/payments/mercado-pago-environment'
import {
  createMercadoPagoOAuthState,
  createPkcePair,
  persistMercadoPagoOAuthAttempt,
} from '@/lib/payments/mercado-pago-oauth'

const MP_AUTH_URL = 'https://auth.mercadopago.cl/authorization'

// OJO: iniciadores OAuth deliberadamente SIN action(): sus throws son invariantes
// de misconfig (inglés, server-only) y el caller <form action> no lee retorno.
// No migrar a UserError/ActionResult.
export async function startMercadoPagoConnect() {
  const { redirectUrl } = await initiateMercadoPagoOAuth()
  redirect(redirectUrl)
}

export async function initiateMercadoPagoOAuth(): Promise<{ redirectUrl: string }> {
  const { businessId, user } = await requireBusinessRole(['owner', 'admin'])
  const environment = requireMercadoPagoEnvironment()

  // Playwright exercises the complete settings UI without contacting Mercado
  // Pago. Both gates are required: the mock provider alone never bypasses OAuth,
  // and validateE2EHeaders also requires the per-request test secret.
  const e2eEmail = process.env.PAYMENT_PROVIDER === 'mock'
    ? await validateE2EHeaders()
    : null
  if (e2eEmail) {
    const connectedAt = new Date()
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
        providerAccountId: '999999999',
        accessTokenEncrypted: 'e2e-mock-no-token',
        status: 'connected',
        connectedAt,
        rawMetadata: { source: 'e2e-mock' },
      },
      update: {
        providerAccountId: '999999999',
        accessTokenEncrypted: 'e2e-mock-no-token',
        refreshTokenEncrypted: null,
        expiresAt: null,
        status: 'connected',
        connectedAt,
        disconnectedAt: null,
        rawMetadata: { source: 'e2e-mock' },
      },
    })
    return { redirectUrl: '/dashboard/settings/payments?success=connected' }
  }

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
    await persistMercadoPagoOAuthAttempt({
      businessId, environment, nonce, verifier, userId: user.id, expiresAt,
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
  const { businessId } = await requireBusinessRole(['owner', 'admin'])
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
  const { businessId } = await requireBusinessRole(['owner', 'admin'])
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
