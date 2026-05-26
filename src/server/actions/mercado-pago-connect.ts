'use server'

import { prisma } from '@/lib/db'
import { requireBusiness } from '@/lib/auth/server'
import { encryptSecret } from '@/lib/payments/encryption'
import { signState } from '@/lib/payments/oauth-state'
import { randomBytes } from 'crypto'
import { redirect } from 'next/navigation'

const MP_AUTH_URL = 'https://auth.mercadopago.cl/authorization'

export async function startMercadoPagoConnect() {
  const { redirectUrl } = await initiateMercadoPagoOAuth()
  redirect(redirectUrl)
}

export async function initiateMercadoPagoOAuth(): Promise<{ redirectUrl: string }> {
  const { businessId } = await requireBusiness()

  const clientId = process.env.MERCADO_PAGO_CLIENT_ID
  const redirectUri = process.env.MERCADO_PAGO_REDIRECT_URI

  if (!clientId || !redirectUri) {
    throw new Error(
      'Mercado Pago integration not configured. Set MERCADO_PAGO_CLIENT_ID and MERCADO_PAGO_REDIRECT_URI.',
    )
  }

  const stateValue = randomBytes(32).toString('hex')
  const expiresAt = Date.now() + 10 * 60 * 1000
  const payload = `${businessId}:${stateValue}:${expiresAt}`

  let signature: string
  try {
    signature = signState(payload)
  } catch {
    throw new Error('ENCRYPTION_KEY must be configured for Mercado Pago OAuth')
  }

  const state = `${payload}:${signature}`

  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    platform_id: 'mp',
    state,
    redirect_uri: redirectUri,
  })

  return { redirectUrl: `${MP_AUTH_URL}?${params.toString()}` }
}

export async function disconnectMercadoPagoConnection() {
  const { businessId } = await requireBusiness()

  const account = await prisma.paymentAccount.findFirst({
    where: { businessId, provider: 'mercado_pago' },
  })

  if (!account) {
    throw new Error('No hay cuenta de Mercado Pago conectada')
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

// Backward-compatible alias
export const disconnectMercadoPago = disconnectMercadoPagoConnection

export async function getPaymentAccountStatus() {
  const { businessId } = await requireBusiness()

  const account = await prisma.paymentAccount.findFirst({
    where: { businessId, provider: 'mercado_pago' },
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
