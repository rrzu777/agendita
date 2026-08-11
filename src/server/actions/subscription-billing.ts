'use server'

import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { Prisma, type MercadoPagoEnvironment, type SubscriptionPlanMapping } from '@prisma/client'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { UserError } from '@/lib/actions/result'
import { requireBusinessRole } from '@/lib/auth/server'
import { requirePlatformAdminUser } from '@/lib/auth/user'
import { prisma } from '@/lib/db'
import { requireMercadoPagoEnvironment } from '@/lib/payments/mercado-pago-environment'
import {
  createMpSubscriptionClient,
  MercadoPagoSubscriptionTransportError,
  type MpSubscriptionClient,
} from '@/lib/subscriptions/mercado-pago-client'
import { applySubscriptionTransition } from '@/lib/subscriptions/transition'
import {
  adoptAuthorizedSubscriptionCandidate,
  CheckoutEligibilityConflictError,
  matchesSubscriptionCheckoutAttempt,
} from '@/lib/subscriptions/checkout-adoption'

const CHECKOUT_LEAD_TIME_MS = 7 * 24 * 60 * 60 * 1_000
const CHECKOUT_ATTEMPT_TTL_MS = 30 * 60 * 1_000
const PLAN_PROVISIONING_LEASE_MS = 5 * 60 * 1_000

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
    provisioningStatus: 'ready' as const,
  }
  const existing = await prisma.subscriptionPlanMapping.findFirst({
    where: exactWhere,
    orderBy: { createdAt: 'desc' },
  })
  if (existing) return activateMapping(existing)

  const now = new Date()
  const reservationId = randomUUID()
  const provisioningToken = opaqueReference()
  const externalReference = `agendita_plan_${reservationId}`
  const leaseExpiresAt = new Date(now.getTime() + PLAN_PROVISIONING_LEASE_MS)
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
        id: reservationId,
        planId: subscription.planId,
        provider: 'mercado_pago',
        environment,
        providerPlanId: null,
        amount: subscription.amount,
        currency: subscription.currency,
        isActive: false,
        provisioningToken,
        provisioningLeaseExpiresAt: leaseExpiresAt,
        externalReference,
        provisioningStatus: 'provisioning',
      },
      update: {},
    })
  } catch (error) {
    if (!isP2002(error)) throw error
    const raced = await prisma.subscriptionPlanMapping.findFirst({
      where: {
        planId: subscription.planId, provider: 'mercado_pago', environment,
        amount: subscription.amount, currency: subscription.currency,
      },
      orderBy: { createdAt: 'desc' },
    })
    if (!raced) throw new UserError('El plan externo todavía se está sincronizando.')
    reservation = raced
  }

  if (reservation.providerPlanId && reservation.provisioningStatus === 'ready') {
    return activateMapping(reservation)
  }
  if (reservation.provisioningStatus === 'manual_reconciliation_required') {
    throw new UserError('El plan externo requiere reconciliación manual exacta.')
  }
  if (reservation.provisioningToken !== provisioningToken) {
    if (!reservation.provisioningToken || !reservation.provisioningLeaseExpiresAt ||
        reservation.provisioningLeaseExpiresAt.getTime() > now.getTime()) {
      throw new UserError('El plan externo todavía se está sincronizando.')
    }
    const marked = await prisma.subscriptionPlanMapping.updateMany({
      where: {
        id: reservation.id,
        providerPlanId: null,
        provisioningToken: reservation.provisioningToken,
        provisioningLeaseExpiresAt: { lte: now },
        provisioningStatus: 'provisioning',
      },
      data: {
        provisioningToken: null,
        provisioningLeaseExpiresAt: null,
        provisioningStatus: 'manual_reconciliation_required',
      },
    })
    if (marked.count !== 1) throw new UserError('El plan externo cambió durante la sincronización.')
    throw new UserError('El plan externo requiere reconciliación manual exacta.')
  }

  if (!reservation.externalReference) {
    throw new Error('La reserva del plan externo no tiene referencia determinista.')
  }
  try {
    const providerPlan = await client.createPlan({
      name: subscription.plan.name,
      amount: subscription.amount,
      externalReference: reservation.externalReference,
    })
    if (
      (providerPlan.externalReference !== null &&
        providerPlan.externalReference !== reservation.externalReference) ||
      (providerPlan.reason !== null && providerPlan.reason !== subscription.plan.name) ||
      providerPlan.status !== 'active' ||
      providerPlan.amount !== subscription.amount || providerPlan.currency !== subscription.currency ||
      providerPlan.frequency !== 1 || providerPlan.frequencyType !== 'months'
    ) {
      throw new Error('El plan externo creado no coincide con el snapshot local.')
    }
    const persisted = await prisma.subscriptionPlanMapping.updateMany({
      where: {
        id: reservation.id,
        providerPlanId: null,
        provisioningToken,
        provisioningStatus: 'provisioning',
      },
      data: {
        providerPlanId: providerPlan.id,
        provisioningToken: null,
        provisioningLeaseExpiresAt: null,
        provisioningStatus: 'ready',
      },
    })
    if (persisted.count !== 1) {
      throw new Error('La reserva del plan externo cambió durante la sincronización.')
    }
    return activateMapping({
      ...reservation,
      providerPlanId: providerPlan.id,
      provisioningToken: null,
      provisioningLeaseExpiresAt: null,
      provisioningStatus: 'ready',
    })
  } catch (error) {
    if (
      error instanceof MercadoPagoSubscriptionTransportError &&
      error.outcome === 'definitive_rejection'
    ) {
      try {
        await prisma.subscriptionPlanMapping.deleteMany({
          where: {
            id: reservation.id,
            providerPlanId: null,
            provisioningToken,
            provisioningStatus: 'provisioning',
          },
        })
      } catch {
        // A failed release leaves the bounded lease fail-closed. The next
        // attempt will require exact reconciliation instead of duplicating it.
      }
      throw error
    }
    try {
      await prisma.subscriptionPlanMapping.updateMany({
        where: {
          id: reservation.id,
          providerPlanId: null,
          provisioningToken,
          provisioningStatus: 'provisioning',
        },
        data: {
          provisioningToken: null,
          provisioningLeaseExpiresAt: null,
          provisioningStatus: 'manual_reconciliation_required',
        },
      })
    } catch {
      // La reserva expira hacia el mismo estado fail-closed en el próximo intento.
    }
    throw error
  }
}

export async function reconcileSubscriptionPlan(providerPlanId: string): Promise<void> {
  const exactProviderPlanId = providerPlanId.trim()
  if (!exactProviderPlanId || exactProviderPlanId.length > 200) {
    throw new UserError('El ID exacto del plan externo no es válido.')
  }
  await requirePlatformAdminUser()
  const { client, environment } = subscriptionClient()
  const [providerPlan, accountId] = await Promise.all([
    client.getPlan(exactProviderPlanId),
    client.getCurrentAccountId(),
  ])
  const providerIsValid = providerPlan.id === exactProviderPlanId &&
    providerPlan.status === 'active' &&
    providerPlan.collectorId === accountId &&
    providerPlan.currency === 'CLP' &&
    providerPlan.frequency === 1 && providerPlan.frequencyType === 'months'
  if (!providerIsValid) {
    throw new UserError('El plan externo exacto no coincide con la cuenta configurada.')
  }

  const candidates = await prisma.subscriptionPlanMapping.findMany({
    where: {
      provider: 'mercado_pago',
      environment,
      amount: providerPlan.amount,
      currency: providerPlan.currency,
      providerPlanId: null,
      provisioningStatus: 'manual_reconciliation_required',
    },
    include: { plan: { select: { name: true } } },
  })
  const matches = candidates.filter((candidate) =>
    !!candidate.externalReference &&
    candidate.amount === providerPlan.amount && candidate.currency === providerPlan.currency &&
    providerPlan.reason !== null && providerPlan.reason === candidate.plan.name &&
    providerPlan.externalReference !== null &&
      providerPlan.externalReference === candidate.externalReference,
  )
  if (matches.length !== 1) {
    throw new UserError('El plan externo exacto no coincide con una única reserva local.')
  }
  const [mapping] = matches

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
    const adopted = await tx.subscriptionPlanMapping.updateMany({
      where: {
        id: mapping.id,
        providerPlanId: null,
        provisioningStatus: 'manual_reconciliation_required',
      },
      data: {
        providerPlanId: exactProviderPlanId,
        provisioningStatus: 'ready',
        isActive: true,
      },
    })
    if (adopted.count !== 1) {
      throw new Error('El plan pendiente cambió durante la reconciliación manual.')
    }
  })
  revalidatePath('/dashboard/billing')
}

type ProviderSubscription = Awaited<ReturnType<MpSubscriptionClient['getSubscription']>>

function matchesAttempt(input: {
  candidate: ProviderSubscription
  attempt: {
    referenceHash: string
    providerSubscriptionId: string | null
    providerPlanId: string | null
    amount: number | null
    currency: string | null
  }
}): boolean {
  return matchesSubscriptionCheckoutAttempt({ ...input, hashReference: referenceHash })
}

async function cancelCandidateAndInvalidate(input: {
  client: MpSubscriptionClient
  candidateId: string
  attemptId: string
}): Promise<void> {
  const cancelled = await input.client.cancelSubscription(input.candidateId)
  if (cancelled.id !== input.candidateId || cancelled.status !== 'canceled') {
    throw new Error('Mercado Pago no confirmó la cancelación del checkout inválido.')
  }
  await prisma.subscriptionCheckoutAttempt.updateMany({
    where: { id: input.attemptId, invalidatedAt: null },
    data: { invalidatedAt: new Date() },
  })
}

async function adoptAuthorizedCandidate(input: {
  candidate: ProviderSubscription
  attemptId: string
  subscription: CheckoutSubscription
  businessId: string
  environment: MercadoPagoEnvironment
  providerPlanId: string
  now: Date
  attempt: {
    providerSubscriptionId: string | null
    providerPlanId: string | null
    planId: string | null
    amount: number | null
    currency: string | null
  }
}): Promise<void> {
  return adoptAuthorizedSubscriptionCandidate(input)
}

export async function startSubscriptionCheckout(): Promise<void> {
  const { businessId, user } = await requireBusinessRole(['owner', 'admin'])
  const { client, environment } = subscriptionClient()
  const now = new Date()
  let subscription = await loadSubscriptionForCheckout(businessId)
  if (!subscription) throw new UserError('No se encontró la suscripción del negocio.')

  const openAttempt = await prisma.subscriptionCheckoutAttempt.findFirst({
    where: { subscriptionId: subscription.id, environment, invalidatedAt: null },
    orderBy: { createdAt: 'desc' },
  })
  if (openAttempt && openAttempt.expiresAt.getTime() > now.getTime()) {
    throw new UserError('Ya hay un checkout de suscripción en proceso.')
  }
  if (openAttempt) {
    if (openAttempt.providerSubscriptionId) {
      const staleCandidate = await client.getSubscription(openAttempt.providerSubscriptionId)
      const exact = matchesAttempt({ candidate: staleCandidate, attempt: openAttempt })
      if (!exact) {
        if (staleCandidate.providerStatus === 'pending' ||
            staleCandidate.providerStatus === 'authorized') {
          await cancelCandidateAndInvalidate({
            client, candidateId: staleCandidate.id, attemptId: openAttempt.id,
          })
        } else {
          await prisma.subscriptionCheckoutAttempt.updateMany({
            where: { id: openAttempt.id, invalidatedAt: null },
            data: { invalidatedAt: new Date() },
          })
        }
        throw new UserError('El checkout vencido no coincide con el estado actual; reintenta.')
      }
      if (staleCandidate.providerStatus === 'authorized') {
        try {
          await adoptAuthorizedCandidate({
            candidate: staleCandidate, attemptId: openAttempt.id, attempt: openAttempt,
            subscription, businessId, environment, providerPlanId: openAttempt.providerPlanId!, now,
          })
        } catch (error) {
          if (error instanceof CheckoutEligibilityConflictError) {
            await cancelCandidateAndInvalidate({
              client, candidateId: staleCandidate.id, attemptId: openAttempt.id,
            })
          }
          throw error
        }
        redirect('/dashboard/billing?subscription=active')
        return
      }
      if (staleCandidate.providerStatus === 'pending') {
        await cancelCandidateAndInvalidate({
          client, candidateId: staleCandidate.id, attemptId: openAttempt.id,
        })
      }
      if (staleCandidate.providerStatus !== 'pending' &&
          staleCandidate.providerStatus !== 'authorized') {
        await prisma.subscriptionCheckoutAttempt.updateMany({
          where: { id: openAttempt.id, invalidatedAt: null },
          data: { invalidatedAt: new Date() },
        })
      }
    }
    if (openAttempt.providerSubscriptionId === null) {
      const invalidated = await prisma.subscriptionCheckoutAttempt.updateMany({
        where: { id: openAttempt.id, invalidatedAt: null, expiresAt: { lte: now } },
        data: { invalidatedAt: now },
      })
      if (invalidated.count !== 1) throw new UserError('Ya hay un checkout de suscripción en proceso.')
    }
    subscription = await loadSubscriptionForCheckout(businessId)
    if (!subscription) throw new UserError('No se encontró la suscripción del negocio.')
  }

  if (process.env.MP_SUBSCRIPTIONS_ENABLED !== 'true') {
    throw new UserError('La facturación automática está deshabilitada.')
  }
  assertCheckoutEligible(subscription, new Date())
  const mapping = await ensureProviderPlan({ subscription, environment, client })
  if (!mapping.providerPlanId) throw new UserError('El plan externo no está disponible.')

  const reference = opaqueReference()
  let attempt: { id: string }
  try {
    attempt = await prisma.$transaction(async (tx) => {
      return tx.subscriptionCheckoutAttempt.create({
        data: {
          businessId,
          subscriptionId: subscription.id,
          environment,
          referenceHash: referenceHash(reference),
          providerPlanId: mapping.providerPlanId,
          planId: subscription.planId,
          amount: subscription.amount,
          currency: subscription.currency,
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
      providerSubscription.planId !== mapping.providerPlanId ||
      providerSubscription.amount !== subscription.amount ||
      providerSubscription.currency !== subscription.currency
    ) {
      throw new Error('La referencia o el precio de la suscripción externa no coincide.')
    }
  } catch (error) {
    if (providerSubscription) {
      try {
        await cancelCandidateAndInvalidate({
          client, candidateId: providerSubscription.id, attemptId: attempt.id,
        })
      } catch {
        // No sustituir la inconsistencia original por el fallo compensatorio.
      }
    } else {
      await prisma.subscriptionCheckoutAttempt.updateMany({
        where: { id: attempt.id, invalidatedAt: null },
        data: { invalidatedAt: new Date() },
      })
    }
    throw error
  }

  try {
    if (!providerSubscription) throw new Error('Mercado Pago no creó la suscripción.')
    const completed = await prisma.subscriptionCheckoutAttempt.updateMany({
      where: {
        id: attempt.id,
        providerSubscriptionId: null,
        invalidatedAt: null,
        subscription: { providerSubscriptionId: null },
      },
      data: {
        providerSubscriptionId: providerSubscription.id,
      },
    })
    if (completed.count !== 1) throw new Error('El checkout ya no está vigente.')
    if (providerSubscription.providerStatus === 'authorized') {
      await adoptAuthorizedCandidate({
        candidate: providerSubscription, attemptId: attempt.id,
        attempt: {
          providerSubscriptionId: providerSubscription.id,
          providerPlanId: mapping.providerPlanId,
          planId: subscription.planId,
          amount: subscription.amount,
          currency: subscription.currency,
        },
        subscription, businessId,
        environment, providerPlanId: mapping.providerPlanId, now: new Date(),
      })
      redirect('/dashboard/billing?subscription=active')
      return
    }
    if (providerSubscription.providerStatus !== 'pending') {
      throw new Error('Mercado Pago devolvió un estado no válido para iniciar el checkout.')
    }
  } catch (error) {
    try {
      await cancelCandidateAndInvalidate({
        client, candidateId: providerSubscription.id, attemptId: attempt.id,
      })
    } catch {
      // El webhook/reconciliador podrá reparar el proveedor; el conflicto local
      // sigue siendo la causa primaria que el caller necesita reintentar.
    }
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
