'use server'

import { prisma } from '@/lib/db'
import { requireBusiness } from '@/lib/auth/server'
import { encryptSecret } from '@/lib/payments/encryption'
import { createHmac, randomBytes } from 'crypto'
import { redirect } from 'next/navigation'

const MP_AUTH_URL = 'https://auth.mercadopago.cl/authorization'
const MP_TOKEN_URL = 'https://api.mercadopago.com/oauth/token'

export async function startMercadoPagoConnect() {
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

  const signature = createHmac('sha256', process.env.ENCRYPTION_KEY || 'dev-secret')
    .update(`${businessId}:${stateValue}:${expiresAt}`)
    .digest('hex')

  const state = `${businessId}:${stateValue}:${expiresAt}:${signature}`

  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    platform_id: 'mp',
    state,
    redirect_uri: redirectUri,
  })

  redirect(`${MP_AUTH_URL}?${params.toString()}`)
}

export async function disconnectMercadoPago() {
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
