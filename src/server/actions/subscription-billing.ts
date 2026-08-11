'use server'

import { createHash, randomBytes } from 'node:crypto'
import { Prisma, type MercadoPagoEnvironment, type SubscriptionPlanMapping } from '@prisma/client'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { UserError } from '@/lib/actions/result'
import { requireBusinessRole } from '@/lib/auth/server'
import { prisma } from '@/lib/db'
import { requireMercadoPagoEnvironment } from '@/lib/payments/mercado-pago-environment'
import {
  createMpSubscriptionClient,
  type MpSubscriptionClient,
} from '@/lib/subscriptions/mercado-pago-client'
import { applySubscriptionTransition } from '@/lib/subscriptions/transition'

const CHECKOUT_LEAD_TIME_MS = 7 * 24 * 60 * 60 * 1_000
const CHECKOUT_ATTEMPT_TTL_MS = 30 * 60 * 1_000

function opaqueReference(): string {
  return randomBytes(32).toString('base64url')
}

function referenceHash(reference: string): string {
  return createHash('sha256').update(reference).digest('hex')
}

function isP2002(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError
    ? error.code === 'P2002'
    : !!error && typeof error === 'object' && (error as { code?: string }).code === 'P2002'
}

function subscriptionClient(): {
  client: MpSubscriptionClient
  environment: MercadoPagoEnvironment
} {
  if (process.env.MP_SUBSCRIPTIONS_ENABLED !== 'true') {
    throw new UserError('La facturación automática está deshabilitada.')
  }

  const environment = requireMercadoPagoEnvironment()
  const prefix = `MERCADO_PAGO_${environment.toUpperCase()}`
  const accessToken = process.env[`${prefix}_ACCESS_TOKEN`]
  const webhookSecret = process.env[`${prefix}_WEBHOOK_SECRET`]
  const callbackUrl = process.env[`${prefix}_SUBSCRIPTIONS_CALLBACK_URL`]
  if (!accessToken || !webhookSecret || !callbackUrl) {
    throw new UserError('La facturación automática no está configurada.')
  }

  return {
    environment,
    client: createMpSubscriptionClient({ accessToken, webhookSecret, callbackUrl, environment }),
  }
}

type CheckoutSubscription = NonNullable<Awaited<ReturnType<typeof loadSubscriptionForCheckout>>>

async function loadSubscriptionForCheckout(businessId: string) {
  return prisma.businessSubscription.findFirst({
    where: { businessId },
    include: { plan: true },
    orderBy: { createdAt: 'desc' },
  })
}

function assertCheckoutEligible(subscription: CheckoutSubscription, now: Date): void {
  if (!subscription.billingEnabled) {
    throw new UserError('La facturación automática no está habilitada para este negocio.')
  }
  if (subscription.interval !== 'monthly') {
    throw new UserError('Sólo se admiten suscripciones mensuales.')
  }
  if (!subscription.plan) {
    throw new UserError('La suscripción no tiene un plan que se pueda sincronizar.')
  }
  if (subscription.complimentaryUntil && subscription.complimentaryUntil.getTime() > now.getTime()) {
    throw new UserError('La exención vigente no solicita un medio de pago.')
  }
  if (subscription.providerSubscriptionId) {
    throw new UserError('Ya existe una suscripción externa para este negocio.')
  }
  if (!Number.isSafeInteger(subscription.amount) || subscription.amount <= 0 || subscription.currency !== 'CLP') {
    throw new UserError('El snapshot de precio del plan no es facturable.')
  }

  if (subscription.status === 'past_due') return
  const trialEndAt = subscription.trialEndAt
  if (
    subscription.status !== 'trialing' ||
    !trialEndAt ||
    trialEndAt.getTime() <= now.getTime() ||
    trialEndAt.getTime() - now.getTime() > CHECKOUT_LEAD_TIME_MS
  ) {
    throw new UserError('El checkout sólo está disponible al acercarse el fin del trial o durante la mora.')
  }
}

async function activateMapping(mapping: SubscriptionPlanMapping): Promise<SubscriptionPlanMapping> {
  if (!mapping.providerPlanId) {
    throw new UserError('El plan externo todavía se está sincronizando.')
  }
  if (mapping.isActive) return mapping

  await prisma.$transaction(async (tx) => {
    await tx.subscriptionPlanMapping.updateMany({
      where: {
        planId: mapping.planId,
        provider: mapping.provider,
        environment: mapping.environment,
        isActive: true,
        id: { not: mapping.id },
      },
      data: { isActive: false },
    })
    await tx.subscriptionPlanMapping.update({
      where: { id: mapping.id },
      data: { isActive: true },
    })
  })
  return { ...mapping, isActive: true }
}

async function ensureProviderPlan(input: {
  subscription: CheckoutSubscription
  environment: MercadoPagoEnvironment
  client: MpSubscriptionClient
}): Promise<SubscriptionPlanMapping> {
  const { subscription, environment, client } = input
  const exactWhere = {
    planId: subscription.planId,
    provider: 'mercado_pago' as const,
    environment,
    amount: subscription.amount,
    currency: subscription.currency,
    providerPlanId: { not: null },
  }
  const existing = await prisma.subscriptionPlanMapping.findFirst({
    where: exactWhere,
    orderBy: { createdAt: 'desc' },
  })
  if (existing) return activateMapping(existing)

  const provisioningToken = opaqueReference()
  let reservation: SubscriptionPlanMapping
  try {
    reservation = await prisma.subscriptionPlanMapping.upsert({
      where: {
        planId_provider_environment_amount_currency: {
          planId: subscription.planId,
          provider: 'mercado_pago',
          environment,
          amount: subscription.amount,
          currency: subscription.currency,
        },
      },
      create: {
        planId: subscription.planId,
        provider: 'mercado_pago',
        environment,
        providerPlanId: null,
        amount: subscription.amount,
        currency: subscription.currency,
        isActive: false,
        provisioningToken,
      },
      update: {},
    })
  } catch (error) {
    if (!isP2002(error)) throw error
    const raced = await prisma.subscriptionPlanMapping.findFirst({
      where: exactWhere,
      orderBy: { createdAt: 'desc' },
    })
    if (!raced) throw new UserError('El plan externo todavía se está sincronizando.')
    return activateMapping(raced)
  }

  if (reservation.providerPlanId) return activateMapping(reservation)
  if (reservation.provisioningToken !== provisioningToken) {
    throw new UserError('El plan externo todavía se está sincronizando.')
  }

  let providerPlanCreated = false
  try {
    const providerPlan = await client.createPlan({
      name: subscription.plan.name,
      amount: subscription.amount,
      externalReference: `plan_${opaqueReference()}`,
    })
    providerPlanCreated = true
    const ready = await prisma.subscriptionPlanMapping.update({
      where: { id: reservation.id },
      data: { providerPlanId: providerPlan.id, provisioningToken: null },
    })
    return activateMapping(ready)
  } catch (error) {
    if (!providerPlanCreated) {
      await prisma.subscriptionPlanMapping.deleteMany({
        where: { id: reservation.id, provisioningToken, providerPlanId: null },
      })
    }
    throw error
  }
}

export async function startSubscriptionCheckout(): Promise<void> {
  const { businessId, user } = await requireBusinessRole(['owner', 'admin'])
  const { client, environment } = subscriptionClient()
  const now = new Date()
  const subscription = await loadSubscriptionForCheckout(businessId)
  if (!subscription) throw new UserError('No se encontró la suscripción del negocio.')
  assertCheckoutEligible(subscription, now)

  const mapping = await ensureProviderPlan({ subscription, environment, client })
  if (!mapping.providerPlanId) throw new UserError('El plan externo no está disponible.')

  const reference = opaqueReference()
  let attempt: { id: string }
  try {
    attempt = await prisma.$transaction(async (tx) => {
      await tx.subscriptionCheckoutAttempt.updateMany({
        where: {
          subscriptionId: subscription.id,
          environment,
          consumedAt: null,
          invalidatedAt: null,
          expiresAt: { lte: now },
        },
        data: { invalidatedAt: now },
      })
      return tx.subscriptionCheckoutAttempt.create({
        data: {
          businessId,
          subscriptionId: subscription.id,
          environment,
          referenceHash: referenceHash(reference),
          expiresAt: new Date(now.getTime() + CHECKOUT_ATTEMPT_TTL_MS),
        },
        select: { id: true },
      })
    })
  } catch (error) {
    if (isP2002(error)) {
      throw new UserError('Ya hay un checkout de suscripción en proceso.')
    }
    throw error
  }

  let providerSubscription:
    | Awaited<ReturnType<MpSubscriptionClient['createSubscription']>>
    | undefined
  try {
    providerSubscription = await client.createSubscription({
      planId: mapping.providerPlanId,
      externalReference: reference,
      payerEmail: user.email ?? undefined,
      amount: subscription.amount,
      startDate: subscription.trialEndAt && subscription.trialEndAt > now
        ? subscription.trialEndAt
        : now,
    })
    if (
      providerSubscription.externalReference !== reference ||
      providerSubscription.amount !== subscription.amount ||
      providerSubscription.currency !== subscription.currency
    ) {
      throw new Error('La referencia o el precio de la suscripción externa no coincide.')
    }
  } catch (error) {
    if (providerSubscription) {
      try {
        await client.cancelSubscription(providerSubscription.id)
      } catch {
        // No sustituir la inconsistencia original por el fallo compensatorio.
      }
    }
    await prisma.subscriptionCheckoutAttempt.updateMany({
      where: { id: attempt.id, invalidatedAt: null },
      data: { invalidatedAt: new Date() },
    })
    throw error
  }

  try {
    if (!providerSubscription) throw new Error('Mercado Pago no creó la suscripción.')
    await prisma.$transaction(async (tx) => {
      const linked = await tx.businessSubscription.updateMany({
        where: {
          id: subscription.id,
          businessId,
          providerSubscriptionId: null,
          updatedAt: subscription.updatedAt,
        },
        data: {
          provider: 'mercado_pago',
          environment,
          providerPlanId: mapping.providerPlanId,
          providerSubscriptionId: providerSubscription.id,
          nextBillingAt: providerSubscription.nextPaymentAt,
        },
      })
      if (linked.count !== 1) throw new Error('La suscripción cambió durante el checkout.')

      const completed = await tx.subscriptionCheckoutAttempt.updateMany({
        where: { id: attempt.id, providerSubscriptionId: null, invalidatedAt: null },
        data: { providerSubscriptionId: providerSubscription.id },
      })
      if (completed.count !== 1) throw new Error('El checkout ya no está vigente.')
    })
  } catch (error) {
    try {
      await client.cancelSubscription(providerSubscription.id)
    } catch {
      // El webhook/reconciliador podrá reparar el proveedor; el conflicto local
      // sigue siendo la causa primaria que el caller necesita reintentar.
    }
    await prisma.subscriptionCheckoutAttempt.updateMany({
      where: { id: attempt.id, invalidatedAt: null },
      data: { invalidatedAt: new Date() },
    })
    throw error
  }

  redirect(providerSubscription.checkoutUrl!)
}

export async function requestSubscriptionCancellation(): Promise<void> {
  const { businessId } = await requireBusinessRole(['owner', 'admin'])
  const { client, environment } = subscriptionClient()
  const subscription = await loadSubscriptionForCheckout(businessId)
  if (!subscription?.providerSubscriptionId) {
    throw new UserError('No existe una suscripción externa para cancelar.')
  }
  if (subscription.environment !== environment || subscription.provider !== 'mercado_pago') {
    throw new UserError('La suscripción externa pertenece a otro entorno.')
  }
  if (subscription.cancelAtPeriodEnd) return

  const cancelled = await client.cancelSubscription(subscription.providerSubscriptionId)
  if (cancelled.id !== subscription.providerSubscriptionId || cancelled.status !== 'canceled') {
    throw new Error('Mercado Pago no confirmó la cancelación de la renovación.')
  }
  await applySubscriptionTransition(prisma, {
    businessId,
    command: { type: 'provider_cancelled', occurredAt: new Date() },
  })
  revalidatePath('/dashboard/billing')
}
