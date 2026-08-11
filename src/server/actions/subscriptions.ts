'use server'

import { prisma } from '@/lib/db'
import { requireBusinessRole } from '@/lib/auth/server'
import { action } from '@/lib/actions/result'
import {
  requestSubscriptionCancellation,
  startSubscriptionCheckout,
} from '@/server/actions/subscription-billing'

export type SubscriptionActionState = { error: string | null }

async function subscriptionActionState(operation: () => Promise<void>): Promise<SubscriptionActionState> {
  const result = await action(operation)()
  return result.ok ? { error: null } : { error: result.error }
}

export async function startSubscriptionAction(
  _previousState: SubscriptionActionState,
  _formData: FormData,
): Promise<SubscriptionActionState> {
  void _previousState
  void _formData
  return subscriptionActionState(startSubscriptionCheckout)
}

export async function cancelSubscriptionAction(
  _previousState: SubscriptionActionState,
  _formData: FormData,
): Promise<SubscriptionActionState> {
  void _previousState
  void _formData
  return subscriptionActionState(requestSubscriptionCancellation)
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
