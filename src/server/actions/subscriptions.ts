'use server'

import { prisma } from '@/lib/db'
import { requireBusinessRole } from '@/lib/auth/server'
import { UserError } from '@/lib/actions/result'
import { logger } from '@/lib/logger'
import { unstable_rethrow } from 'next/navigation'
import { MercadoPagoSubscriptionTransportError } from '@/lib/subscriptions/mercado-pago-client'
import {
  requestSubscriptionCancellation,
  startSubscriptionCheckout,
} from '@/server/actions/subscription-billing'

export type SubscriptionActionState = { error: string | null }

type OwnerSubscriptionOperation = 'start_checkout' | 'cancel_renewal'

const GENERIC_SUBSCRIPTION_ACTION_ERROR = 'Ocurrió un error inesperado. Intenta nuevamente.'

function safeFailureMetadata(error: unknown, operation: OwnerSubscriptionOperation) {
  if (error instanceof MercadoPagoSubscriptionTransportError) {
    const statusCategory = error.status === null
      ? 'unavailable'
      : error.status >= 500
        ? '5xx'
        : error.status >= 400
          ? '4xx'
          : 'other'
    return {
      operation,
      classification: 'provider_transport',
      providerOutcome: error.outcome,
      statusCategory,
    } as const
  }
  return { operation, classification: 'unexpected' } as const
}

async function subscriptionActionState(
  operation: OwnerSubscriptionOperation,
  execute: () => Promise<void>,
): Promise<SubscriptionActionState> {
  try {
    await execute()
    return { error: null }
  } catch (error) {
    unstable_rethrow(error)
    if (error instanceof UserError) return { error: error.message }
    logger.error(
      'subscription_billing.owner_action_failed',
      'Owner subscription billing action failed.',
      { metadata: safeFailureMetadata(error, operation) },
    )
    return { error: GENERIC_SUBSCRIPTION_ACTION_ERROR }
  }
}

export async function startSubscriptionAction(
  _previousState: SubscriptionActionState,
  _formData: FormData,
): Promise<SubscriptionActionState> {
  void _previousState
  void _formData
  return subscriptionActionState('start_checkout', startSubscriptionCheckout)
}

export async function cancelSubscriptionAction(
  _previousState: SubscriptionActionState,
  _formData: FormData,
): Promise<SubscriptionActionState> {
  void _previousState
  void _formData
  return subscriptionActionState('cancel_renewal', requestSubscriptionCancellation)
}

// businessId SIEMPRE sale de la sesión autenticada, nunca de un parámetro del
// caller: cada export de un módulo 'use server' es un endpoint POST público, así
// que aceptar un businessId arbitrario acá filtraría el historial de pagos de
// otro tenant. El estado de suscripción por businessId vive en
// '@/lib/subscriptions/enforcement' (no expuesto como acción).
export async function getCurrentSubscription() {
  const { businessId } = await requireBusinessRole(['owner', 'admin'])

  const [subscription, payments] = await Promise.all([
    prisma.businessSubscription.findFirst({
      where: { businessId },
      select: {
        id: true,
        status: true,
        interval: true,
        currentPeriodStart: true,
        currentPeriodEnd: true,
        trialStartAt: true,
        trialEndAt: true,
        nextBillingAt: true,
        pastDueAt: true,
        graceEndsAt: true,
        cancelAtPeriodEnd: true,
        complimentaryUntil: true,
        billingEnabled: true,
        providerSubscriptionId: true,
        plan: {
          select: {
            name: true,
            priceMonthly: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.subscriptionPayment.findMany({
      where: { businessId },
      select: {
        id: true,
        amount: true,
        currency: true,
        status: true,
        paymentMethod: true,
        notes: true,
        paidAt: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
    }),
  ])

  if (!subscription) return { subscription: null, payments }

  const { providerSubscriptionId, ...safeSubscription } = subscription
  return {
    subscription: {
      ...safeSubscription,
      hasProviderSubscription: providerSubscriptionId !== null,
    },
    payments,
  }
}
