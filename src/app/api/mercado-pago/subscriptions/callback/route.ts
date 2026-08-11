import { createHash } from 'node:crypto'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireMercadoPagoEnvironment } from '@/lib/payments/mercado-pago-environment'
import { createMpSubscriptionClient } from '@/lib/subscriptions/mercado-pago-client'

type CallbackResult = 'processing' | 'active' | 'failed'

function redirectToBilling(request: Request, result: CallbackResult): NextResponse {
  return NextResponse.redirect(
    new URL(`/dashboard/billing?subscription=${result}`, request.url),
  )
}

function hashReference(reference: string): string {
  return createHash('sha256').update(reference).digest('hex')
}

function referenceFrom(request: Request): string | null {
  const url = new URL(request.url)
  const reference = url.searchParams.get('state') ?? url.searchParams.get('external_reference')
  return reference && /^[A-Za-z0-9_-]{43}$/.test(reference) ? reference : null
}

export async function GET(request: Request): Promise<NextResponse> {
  const reference = referenceFrom(request)
  if (!reference || process.env.MP_SUBSCRIPTIONS_ENABLED !== 'true') {
    return redirectToBilling(request, 'failed')
  }

  try {
    const environment = requireMercadoPagoEnvironment()
    const prefix = `MERCADO_PAGO_${environment.toUpperCase()}`
    const accessToken = process.env[`${prefix}_ACCESS_TOKEN`]
    const webhookSecret = process.env[`${prefix}_WEBHOOK_SECRET`]
    const callbackUrl = process.env[`${prefix}_SUBSCRIPTIONS_CALLBACK_URL`]
    if (!accessToken || !webhookSecret || !callbackUrl) {
      return redirectToBilling(request, 'failed')
    }

    const now = new Date()
    const attempt = await prisma.$transaction(async (tx) => {
      const candidate = await tx.subscriptionCheckoutAttempt.findFirst({
        where: {
          referenceHash: hashReference(reference),
          environment,
          consumedAt: null,
          expiresAt: { gt: now },
        },
        include: { subscription: { select: { amount: true, currency: true } } },
      })
      if (!candidate?.providerSubscriptionId || candidate.invalidatedAt) return null

      const consumed = await tx.subscriptionCheckoutAttempt.updateMany({
        where: { id: candidate.id, consumedAt: null },
        data: { consumedAt: now },
      })
      return consumed.count === 1 ? candidate : null
    })
    if (!attempt?.providerSubscriptionId) return redirectToBilling(request, 'failed')

    // The return URL is only a provisional signal. Query parameters never
    // authorize a payment or mutate subscription entitlement.
    const providerSubscription = await createMpSubscriptionClient({
      accessToken,
      webhookSecret,
      callbackUrl,
      environment,
    }).getSubscription(attempt.providerSubscriptionId)

    const exactMatch =
      providerSubscription.id === attempt.providerSubscriptionId &&
      providerSubscription.externalReference === reference &&
      providerSubscription.amount === attempt.subscription.amount &&
      providerSubscription.currency === attempt.subscription.currency
    if (!exactMatch) return redirectToBilling(request, 'failed')

    if (providerSubscription.status === 'active') {
      return redirectToBilling(request, 'active')
    }
    if (providerSubscription.status === 'pending') {
      return redirectToBilling(request, 'processing')
    }
    return redirectToBilling(request, 'failed')
  } catch {
    return redirectToBilling(request, 'failed')
  }
}
