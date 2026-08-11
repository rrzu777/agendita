import {
  Prisma,
  type MercadoPagoEnvironment,
  type PrismaClient,
  type SubscriptionProvider,
  type SubscriptionStatus as PrismaSubscriptionStatus,
} from '@prisma/client'
import { randomUUID } from 'node:crypto'
import { queueSubscriptionNotification, type SubscriptionNotificationKind } from '@/lib/notifications/subscriptions'
import {
  deriveSubscriptionTransition,
  type DerivedSubscriptionTransition,
  type SubscriptionCommand,
  type SubscriptionState,
} from './state-machine'

type TransitionActor = {
  userId?: string
  email?: string
  notes?: string
}

type ProviderPayment = {
  providerPaymentId?: string
  providerInvoiceId?: string
  providerStatus?: string
  providerUpdatedAt?: Date
  safeMetadata?: Prisma.InputJsonValue
}

export type AdminSubscriptionCommand =
  | { type: 'admin_record_payment'; amount: number; paidAt: Date; notes?: string }
  | { type: 'admin_extend_trial'; days: number; at: Date }
  | { type: 'admin_suspend'; occurredAt: Date; reason?: string }
  | { type: 'admin_activate'; occurredAt: Date }
  | { type: 'admin_change_plan'; planId: string }
  | { type: 'admin_mark_past_due'; occurredAt: Date }
  | { type: 'admin_cancel'; occurredAt: Date; reason?: string }
  | { type: 'admin_clear_complimentary'; occurredAt: Date }
  | { type: 'admin_set_complimentary'; complimentaryUntil: Date; reason: string }

export type ApplySubscriptionTransitionCommand = {
  subscriptionId?: string
  businessId?: string
  command: SubscriptionCommand | AdminSubscriptionCommand
  payment?: ProviderPayment
  actor?: TransitionActor
  expectedProviderSnapshot?: {
    provider: SubscriptionProvider
    environment: MercadoPagoEnvironment
    providerSubscriptionId: string
    planId: string
    providerPlanId: string
    amount: number
    currency: string
  }
  expectedCancellationProviderSnapshot?: {
    provider: 'mercado_pago'
    environment: MercadoPagoEnvironment
    providerSubscriptionId: string
  }
  recoveryAdoption?: {
    attemptId: string
    businessId: string
    environment: MercadoPagoEnvironment
    providerSubscriptionId: string
    providerPlanId: string
    planId: string
    amount: number
    currency: string
    requestedAt: Date
  }
}

export class SubscriptionTransitionConflictError extends Error {
  constructor() {
    super('La suscripción cambió durante la transición; reintente con el estado actual')
    this.name = 'SubscriptionTransitionConflictError'
  }
}

export class SubscriptionProviderSnapshotMismatchError extends Error {
  constructor() {
    super('La suscripción ya no coincide con el snapshot verificado del proveedor')
    this.name = 'SubscriptionProviderSnapshotMismatchError'
  }
}

export class SubscriptionProviderPaymentOwnershipConflictError extends Error {
  constructor() {
    super('El pago externo ya pertenece a otra suscripción')
    this.name = 'SubscriptionProviderPaymentOwnershipConflictError'
  }
}

function lifecycleNotification(input: {
  subscription: { businessId: string; id: string; status: PrismaSubscriptionStatus; currentPeriodEnd: Date }
  derived: DerivedSubscriptionTransition
  command: SubscriptionCommand | AdminSubscriptionCommand
}): { kind: SubscriptionNotificationKind; effectiveDate: Date; eventAt: Date } | null {
  const { subscription, derived, command } = input
  const kind: SubscriptionNotificationKind | null = derived.auditAction === 'invoice_approved'
    ? subscription.status === 'trialing' ? 'subscription_activated' : 'subscription_payment_approved'
    : derived.auditAction === 'subscription_recovered' ? 'subscription_recovered'
      : derived.auditAction === 'invoice_failed' || derived.auditAction === 'marked_past_due_by_admin'
        ? 'subscription_payment_failed'
        : derived.auditAction === 'subscription_suspended' || derived.auditAction === 'business_suspended_by_admin'
          ? 'subscription_suspended'
          : derived.auditAction === 'business_activated_by_admin' ? 'subscription_activated'
            : derived.auditAction?.startsWith('subscription_cancellation_requested')
              ? 'subscription_cancellation_requested'
              : derived.auditAction === 'subscription_cancelled_at_period_end'
                ? 'subscription_cancelled'
                : derived.auditAction === 'payment_recorded_by_admin'
                  ? subscription.status === 'past_due' ? 'subscription_recovered' : 'subscription_payment_approved'
                  : null
  if (!kind) return null
  const occurredAt = command.type === 'invoice_approved' ? command.paidAt
    : command.type === 'admin_record_payment' ? command.paidAt
    : command.type === 'invoice_failed' ? command.occurredAt
      : command.type === 'time_elapsed' ? command.at
        : command.type === 'cancel_at_period_end' ? command.requestedAt
          : command.type === 'provider_cancelled' ? command.occurredAt
            : 'occurredAt' in command ? command.occurredAt
              : subscription.currentPeriodEnd
  return {
    kind,
    effectiveDate: kind === 'subscription_cancellation_requested' ? subscription.currentPeriodEnd : occurredAt,
    eventAt: occurredAt,
  }
}

export async function findExistingProviderPaymentClaim(
  tx: PrismaClient | Prisma.TransactionClient,
  input: {
    provider: SubscriptionProvider
    environment: MercadoPagoEnvironment
    providerPaymentId?: string
    providerInvoiceId?: string
    subscriptionId: string
    businessId: string
  },
) {
  const identifiers: Prisma.SubscriptionPaymentWhereInput[] = [
    ...(input.providerPaymentId ? [{ providerPaymentId: input.providerPaymentId }] : []),
    ...(input.providerInvoiceId ? [{ providerInvoiceId: input.providerInvoiceId }] : []),
  ]
  if (identifiers.length === 0) return null
  const claims = await tx.subscriptionPayment.findMany({
    where: {
      provider: input.provider,
      environment: input.environment,
      OR: identifiers,
    },
    select: {
      id: true,
      businessId: true,
      subscriptionId: true,
      provider: true,
      environment: true,
      status: true,
      providerPaymentId: true,
      providerInvoiceId: true,
    },
  })
  if (claims.length === 0) return null
  const first = claims[0]
  if (
    claims.some((claim) =>
      claim.id !== first.id ||
      claim.subscriptionId !== input.subscriptionId ||
      claim.businessId !== input.businessId ||
      claim.provider !== input.provider ||
      claim.environment !== input.environment
    ) ||
    (first.providerPaymentId !== null && input.providerPaymentId !== undefined &&
      first.providerPaymentId !== input.providerPaymentId) ||
    (first.providerInvoiceId !== null && first.providerInvoiceId !== input.providerInvoiceId)
  ) {
    throw new SubscriptionProviderPaymentOwnershipConflictError()
  }
  return first
}

function toState(subscription: {
  status: PrismaSubscriptionStatus
  provider: SubscriptionProvider
  interval: 'monthly' | 'yearly'
  currentPeriodStart: Date
  currentPeriodEnd: Date
  trialStartAt: Date | null
  trialEndAt: Date | null
  trialDays: number
  cancelledAt: Date | null
  suspendedAt: Date | null
  suspendedReason: string | null
  nextBillingAt: Date | null
  lastPaidAt: Date | null
  pastDueAt: Date | null
  graceEndsAt: Date | null
  graceDays: number
  graceEnforcementDeferredAt: Date | null
  cancelAtPeriodEnd: boolean
  cancellationRequestedAt: Date | null
  complimentaryUntil: Date | null
  providerSubscriptionId: string | null
}): SubscriptionState {
  return subscription
}

function adminTransition(
  subscription: SubscriptionState,
  command: AdminSubscriptionCommand,
): DerivedSubscriptionTransition & {
  subscriptionData?: Prisma.BusinessSubscriptionUncheckedUpdateManyInput
  businessData?: Prisma.BusinessUncheckedUpdateInput
} {
  switch (command.type) {
    case 'admin_record_payment':
      return {
        nextStatus: 'active',
        changes: {
          lastPaidAt: command.paidAt,
          pastDueAt: null,
          graceEndsAt: null,
          graceEnforcementDeferredAt: null,
          suspendedAt: null,
          suspendedReason: null,
        },
        auditAction: 'payment_recorded_by_admin',
        ignored: false,
      }
    case 'admin_extend_trial': {
      const trialEndAt = new Date(
        Math.max(subscription.trialEndAt?.getTime() ?? command.at.getTime(), command.at.getTime()) +
          command.days * 24 * 60 * 60 * 1000,
      )
      return {
        nextStatus: 'trialing',
        changes: {
          trialEndAt,
          currentPeriodEnd: trialEndAt,
          trialDays: Math.min(365, subscription.trialDays + command.days),
        },
        businessData: { trialEndsAt: trialEndAt },
        auditAction: 'trial_extended_by_admin',
        ignored: false,
      }
    }
    case 'admin_suspend':
      return {
        nextStatus: 'suspended',
        changes: {
          suspendedAt: command.occurredAt,
          suspendedReason: command.reason ?? null,
        },
        auditAction: 'business_suspended_by_admin',
        ignored: false,
      }
    case 'admin_activate':
      return {
        nextStatus: 'active',
        changes: { suspendedAt: null, suspendedReason: null, pastDueAt: null, graceEndsAt: null },
        auditAction: 'business_activated_by_admin',
        ignored: false,
      }
    case 'admin_change_plan':
      return {
        nextStatus: subscription.status,
        changes: {},
        subscriptionData: { planId: command.planId },
        businessData: { planId: command.planId },
        auditAction: 'plan_changed_by_admin',
        ignored: false,
      }
    case 'admin_mark_past_due':
      return {
        nextStatus: 'past_due',
        changes: {
          pastDueAt: subscription.pastDueAt ?? command.occurredAt,
          graceEndsAt: subscription.graceEndsAt ?? new Date(
            command.occurredAt.getTime() + subscription.graceDays * 24 * 60 * 60 * 1000,
          ),
          graceEnforcementDeferredAt: null,
        },
        auditAction: 'marked_past_due_by_admin',
        ignored: false,
      }
    case 'admin_cancel':
      return {
        nextStatus: subscription.status,
        changes: {
          cancelAtPeriodEnd: true,
          cancellationRequestedAt: command.occurredAt,
        },
        auditAction: 'subscription_cancellation_requested_by_admin',
        ignored: false,
      }
    case 'admin_clear_complimentary': {
      if (
        !subscription.complimentaryUntil ||
        subscription.complimentaryUntil.getTime() <= command.occurredAt.getTime()
      ) {
        throw new Error('No hay una exención vigente para retirar')
      }
      const trialEndAt = new Date(
        command.occurredAt.getTime() + subscription.trialDays * 24 * 60 * 60 * 1000,
      )
      if (subscription.trialDays === 0) {
        return {
          nextStatus: 'past_due',
          changes: {
            trialStartAt: command.occurredAt,
            trialEndAt: command.occurredAt,
            currentPeriodStart: command.occurredAt,
            currentPeriodEnd: command.occurredAt,
            complimentaryUntil: null,
            pastDueAt: command.occurredAt,
            graceEndsAt: new Date(
              command.occurredAt.getTime() + subscription.graceDays * 24 * 60 * 60 * 1000,
            ),
            graceEnforcementDeferredAt: null,
            suspendedAt: null,
            suspendedReason: null,
          },
          subscriptionData: { complimentaryReason: null },
          businessData: { trialEndsAt: command.occurredAt },
          auditAction: 'complimentary_period_cleared',
          ignored: false,
        }
      }
      return {
        nextStatus: 'trialing',
        changes: {
          trialStartAt: command.occurredAt,
          trialEndAt,
          currentPeriodStart: command.occurredAt,
          currentPeriodEnd: trialEndAt,
          complimentaryUntil: null,
          pastDueAt: null,
          graceEndsAt: null,
          graceEnforcementDeferredAt: null,
          suspendedAt: null,
          suspendedReason: null,
        },
        subscriptionData: { complimentaryReason: null },
        businessData: { trialEndsAt: trialEndAt },
        auditAction: 'complimentary_period_cleared',
        ignored: false,
      }
    }
    case 'admin_set_complimentary':
      if (subscription.providerSubscriptionId) {
        throw new Error('Primero cancela y confirma la autorización externa antes de asignar una exención')
      }
      return {
        nextStatus: 'trialing',
        changes: {
          complimentaryUntil: command.complimentaryUntil,
          pastDueAt: null,
          graceEndsAt: null,
          graceEnforcementDeferredAt: null,
          suspendedAt: null,
          suspendedReason: null,
        },
        subscriptionData: { complimentaryReason: command.reason },
        auditAction: 'complimentary_period_set',
        ignored: false,
      }
  }
}

function isAdminCommand(
  command: SubscriptionCommand | AdminSubscriptionCommand,
): command is AdminSubscriptionCommand {
  return command.type.startsWith('admin_')
}

export async function applySubscriptionTransition(
  prisma: PrismaClient,
  input: ApplySubscriptionTransitionCommand,
) {
  if (!input.subscriptionId && !input.businessId) {
    throw new Error('subscriptionId o businessId es requerido')
  }

  return prisma.$transaction(async (tx) => {
    const subscription = input.subscriptionId
      ? await tx.businessSubscription.findUnique({ where: { id: input.subscriptionId } })
      : await tx.businessSubscription.findFirst({
          where: { businessId: input.businessId },
          orderBy: { createdAt: 'desc' },
        })

    if (!subscription) throw new Error('No se encontró suscripción para este negocio')
    if (input.businessId && subscription.businessId !== input.businessId) {
      throw new Error('La suscripción no pertenece al negocio indicado')
    }
    const expected = input.expectedProviderSnapshot
    const recovery = input.recoveryAdoption
    let existingPaymentClaim: Awaited<ReturnType<typeof findExistingProviderPaymentClaim>> = null
    if (recovery && input.command.type !== 'invoice_approved') {
      throw new Error('La recuperación de checkout sólo admite una factura aprobada')
    }
    if (input.command.type === 'invoice_approved' || input.command.type === 'invoice_failed') {
      const paymentProvider = recovery ? 'mercado_pago' : expected?.provider ?? subscription.provider
      const paymentEnvironment = recovery?.environment ?? expected?.environment ?? subscription.environment
      if (paymentProvider !== 'mercado_pago' || !paymentEnvironment) {
        throw new Error('Un pago externo requiere proveedor Mercado Pago y ambiente')
      }
      existingPaymentClaim = await findExistingProviderPaymentClaim(tx, {
        provider: paymentProvider,
        environment: paymentEnvironment,
        providerPaymentId: input.command.type === 'invoice_approved'
          ? input.command.providerPaymentId
          : input.payment?.providerPaymentId,
        providerInvoiceId: input.payment?.providerInvoiceId,
        subscriptionId: subscription.id,
        businessId: subscription.businessId,
      })
      const failedClaimIsCurrent = input.command.type === 'invoice_failed' &&
        existingPaymentClaim?.status === (
          input.payment?.providerStatus === 'cancelled' ? 'cancelled' : 'rejected'
        ) &&
        existingPaymentClaim.providerInvoiceId === input.payment?.providerInvoiceId &&
        (input.payment?.providerPaymentId === undefined ||
          existingPaymentClaim.providerPaymentId === input.payment.providerPaymentId)
      if (
        existingPaymentClaim &&
        (
          (input.command.type === 'invoice_failed' &&
            (existingPaymentClaim.status === 'approved' || failedClaimIsCurrent)) ||
          (
            existingPaymentClaim.status === 'approved' &&
            existingPaymentClaim.providerPaymentId !== null &&
            existingPaymentClaim.providerInvoiceId !== null
          )
        )
      ) {
        return { applied: false, status: subscription.status }
      }
    }
    if (expected && (
      subscription.provider !== expected.provider ||
      subscription.environment !== expected.environment ||
      subscription.providerSubscriptionId !== expected.providerSubscriptionId ||
      subscription.planId !== expected.planId ||
      subscription.providerPlanId !== expected.providerPlanId ||
      subscription.amount !== expected.amount ||
      subscription.currency !== expected.currency
    )) {
      throw new SubscriptionProviderSnapshotMismatchError()
    }
    if (subscription.interval !== 'monthly') {
      throw new Error('Sólo se admiten suscripciones monthly')
    }

    if (recovery) {
      if (
        subscription.businessId !== recovery.businessId ||
        (subscription.providerSubscriptionId !== null &&
          subscription.providerSubscriptionId !== recovery.providerSubscriptionId)
      ) {
        throw new SubscriptionProviderSnapshotMismatchError()
      }
      const claimedAttempt = await tx.subscriptionCheckoutAttempt.updateMany({
        where: {
          id: recovery.attemptId,
          businessId: recovery.businessId,
          subscriptionId: subscription.id,
          environment: recovery.environment,
          providerSubscriptionId: recovery.providerSubscriptionId,
          providerPlanId: recovery.providerPlanId,
          planId: recovery.planId,
          amount: recovery.amount,
          currency: recovery.currency,
          invalidatedAt: null,
        },
        data: { invalidatedAt: recovery.requestedAt },
      })
      if (claimedAttempt.count !== 1) throw new SubscriptionTransitionConflictError()
    }

    if (input.command.type === 'invoice_approved' || input.command.type === 'invoice_failed') {
      const paymentProvider = recovery ? 'mercado_pago' : subscription.provider
      const paymentEnvironment = recovery?.environment ?? subscription.environment
      if (paymentProvider !== 'mercado_pago' || !paymentEnvironment) {
        throw new Error('Un pago externo requiere proveedor Mercado Pago y ambiente')
      }
      let candidatePaymentId: string = randomUUID()
      let claim: { count: number }
      const approvedPaymentData = (
        currentClaim: NonNullable<typeof existingPaymentClaim>,
      ) => input.command.type === 'invoice_approved'
        ? {
            status: 'approved' as const,
            paidAt: input.command.paidAt,
            ...(currentClaim.providerPaymentId === null
              ? { providerPaymentId: input.command.providerPaymentId }
              : {}),
            ...(currentClaim.providerInvoiceId === null
              ? { providerInvoiceId: input.payment?.providerInvoiceId }
              : {}),
            providerStatus: input.payment?.providerStatus,
            providerUpdatedAt: input.payment?.providerUpdatedAt,
            rawPayload: input.payment?.safeMetadata,
          }
        : null
      const failedPaymentData = (
        currentClaim: NonNullable<typeof existingPaymentClaim>,
      ) => input.command.type === 'invoice_failed'
        ? {
            status: input.payment?.providerStatus === 'cancelled'
              ? 'cancelled' as const
              : 'rejected' as const,
            ...(currentClaim.providerPaymentId === null
              ? { providerPaymentId: input.payment?.providerPaymentId }
              : {}),
            ...(currentClaim.providerInvoiceId === null
              ? { providerInvoiceId: input.payment?.providerInvoiceId }
              : {}),
            providerStatus: input.payment?.providerStatus,
            providerUpdatedAt: input.payment?.providerUpdatedAt,
            rawPayload: input.payment?.safeMetadata,
          }
        : null
      if (input.command.type === 'invoice_approved' && existingPaymentClaim) {
        candidatePaymentId = existingPaymentClaim.id
        claim = await tx.subscriptionPayment.updateMany({
          where: {
            id: existingPaymentClaim.id,
            businessId: subscription.businessId,
            subscriptionId: subscription.id,
            provider: paymentProvider,
            environment: paymentEnvironment,
            status: existingPaymentClaim.status,
            providerPaymentId: existingPaymentClaim.providerPaymentId,
            providerInvoiceId: existingPaymentClaim.providerInvoiceId,
          },
          data: approvedPaymentData(existingPaymentClaim)!,
        })
      } else if (input.command.type === 'invoice_failed' && existingPaymentClaim) {
        candidatePaymentId = existingPaymentClaim.id
        claim = await tx.subscriptionPayment.updateMany({
          where: {
            id: existingPaymentClaim.id,
            businessId: subscription.businessId,
            subscriptionId: subscription.id,
            provider: paymentProvider,
            environment: paymentEnvironment,
            status: existingPaymentClaim.status,
            providerPaymentId: existingPaymentClaim.providerPaymentId,
            providerInvoiceId: existingPaymentClaim.providerInvoiceId,
          },
          data: failedPaymentData(existingPaymentClaim)!,
        })
      } else {
        claim = await tx.subscriptionPayment.createMany({
          data: [{
            id: candidatePaymentId,
            businessId: subscription.businessId,
            subscriptionId: subscription.id,
            amount: recovery?.amount ?? subscription.amount,
            currency: recovery?.currency ?? subscription.currency,
            status: input.command.type === 'invoice_approved'
              ? 'approved'
              : input.payment?.providerStatus === 'cancelled'
                ? 'cancelled'
                : input.payment?.providerStatus === 'rejected'
                  ? 'rejected'
                  : 'failed',
            paidAt: input.command.type === 'invoice_approved' ? input.command.paidAt : null,
            provider: paymentProvider,
            environment: paymentEnvironment,
            providerPaymentId: input.command.type === 'invoice_approved'
              ? input.command.providerPaymentId
              : input.payment?.providerPaymentId,
            providerInvoiceId: input.payment?.providerInvoiceId,
            providerStatus: input.payment?.providerStatus,
            providerUpdatedAt: input.payment?.providerUpdatedAt,
            rawPayload: input.payment?.safeMetadata,
          }],
          skipDuplicates: true,
        })
      }
      let claimedPayment = await findExistingProviderPaymentClaim(tx, {
        provider: paymentProvider,
        environment: paymentEnvironment,
        providerPaymentId: input.command.type === 'invoice_approved'
          ? input.command.providerPaymentId
          : input.payment?.providerPaymentId,
        providerInvoiceId: input.payment?.providerInvoiceId,
        subscriptionId: subscription.id,
        businessId: subscription.businessId,
      })
      if (!claimedPayment) {
        throw new Error('El pago externo colisiona con otra clave única')
      }
      if (
        input.command.type === 'invoice_approved' &&
        claim.count === 0 &&
        (
          claimedPayment.status !== 'approved' ||
          claimedPayment.providerPaymentId === null ||
          claimedPayment.providerInvoiceId === null
        )
      ) {
        candidatePaymentId = claimedPayment.id
        claim = await tx.subscriptionPayment.updateMany({
          where: {
            id: claimedPayment.id,
            businessId: subscription.businessId,
            subscriptionId: subscription.id,
            provider: paymentProvider,
            environment: paymentEnvironment,
            status: claimedPayment.status,
            providerPaymentId: claimedPayment.providerPaymentId,
            providerInvoiceId: claimedPayment.providerInvoiceId,
          },
          data: approvedPaymentData(claimedPayment)!,
        })
        claimedPayment = await findExistingProviderPaymentClaim(tx, {
          provider: paymentProvider,
          environment: paymentEnvironment,
          providerPaymentId: input.command.providerPaymentId,
          providerInvoiceId: input.payment?.providerInvoiceId,
          subscriptionId: subscription.id,
          businessId: subscription.businessId,
        })
        if (!claimedPayment) throw new Error('El pago externo colisiona con otra clave única')
      }
      if (
        input.command.type === 'invoice_failed' &&
        claim.count === 0 &&
        claimedPayment.status !== 'approved' &&
        (
          claimedPayment.status !== (
            input.payment?.providerStatus === 'cancelled' ? 'cancelled' : 'rejected'
          ) ||
          claimedPayment.providerPaymentId !== (input.payment?.providerPaymentId ?? null) ||
          claimedPayment.providerInvoiceId !== input.payment?.providerInvoiceId
        )
      ) {
        candidatePaymentId = claimedPayment.id
        claim = await tx.subscriptionPayment.updateMany({
          where: {
            id: claimedPayment.id,
            businessId: subscription.businessId,
            subscriptionId: subscription.id,
            provider: paymentProvider,
            environment: paymentEnvironment,
            status: claimedPayment.status,
            providerPaymentId: claimedPayment.providerPaymentId,
            providerInvoiceId: claimedPayment.providerInvoiceId,
          },
          data: failedPaymentData(claimedPayment)!,
        })
        claimedPayment = await findExistingProviderPaymentClaim(tx, {
          provider: paymentProvider,
          environment: paymentEnvironment,
          providerPaymentId: input.payment?.providerPaymentId,
          providerInvoiceId: input.payment?.providerInvoiceId,
          subscriptionId: subscription.id,
          businessId: subscription.businessId,
        })
        if (!claimedPayment) throw new Error('El pago externo colisiona con otra clave única')
      }
      if (claim.count === 0 || claimedPayment.id !== candidatePaymentId) {
        const latest = await tx.businessSubscription.findUnique({
          where: { id: subscription.id },
          select: { status: true },
        })
        return { applied: false, status: latest?.status ?? subscription.status }
      }
    }

    if (input.command.type === 'invoice_failed') {
      const coveringManualPayment = await tx.subscriptionPayment.findFirst({
        where: {
          subscriptionId: subscription.id,
          status: 'approved',
          paidAt: { gte: input.command.occurredAt },
          OR: [{ provider: 'manual' }, { paymentMethod: 'manual' }],
        },
        select: { id: true },
      })
      if (coveringManualPayment) {
        return { applied: false, status: subscription.status }
      }
    }

    let transitionCommand = input.command
    if (input.command.type === 'time_elapsed') {
      const cancellationSnapshot = input.expectedCancellationProviderSnapshot
      let providerCancellationConfirmed = false
      if (cancellationSnapshot) {
        if (
          subscription.provider !== cancellationSnapshot.provider ||
          subscription.environment !== cancellationSnapshot.environment ||
          subscription.providerSubscriptionId !== cancellationSnapshot.providerSubscriptionId
        ) {
          throw new SubscriptionProviderSnapshotMismatchError()
        }
        providerCancellationConfirmed = true
      }
      transitionCommand = { ...input.command, providerCancellationConfirmed }
    }

    const before = toState(subscription)
    const derived: DerivedSubscriptionTransition & {
      subscriptionData?: Prisma.BusinessSubscriptionUncheckedUpdateManyInput
      businessData?: Prisma.BusinessUncheckedUpdateInput
    } = isAdminCommand(transitionCommand)
      ? adminTransition(before, transitionCommand)
      : deriveSubscriptionTransition({
          subscription: before,
          command: transitionCommand,
          paymentAlreadyApplied: false,
        })

    if (derived.ignored) {
      return { applied: false, status: subscription.status }
    }

    const subscriptionData: Prisma.BusinessSubscriptionUncheckedUpdateManyInput = {
      ...derived.changes,
      ...(derived.subscriptionData ?? {}),
      ...(recovery ? {
        provider: 'mercado_pago',
        environment: recovery.environment,
        providerSubscriptionId: recovery.providerSubscriptionId,
        providerPlanId: recovery.providerPlanId,
        planId: recovery.planId,
        amount: recovery.amount,
        currency: recovery.currency,
        cancelAtPeriodEnd: true,
        cancellationRequestedAt: subscription.cancellationRequestedAt ?? recovery.requestedAt,
      } : {}),
      status: derived.nextStatus,
    }
    const updated = await tx.businessSubscription.updateMany({
      where: {
        id: subscription.id,
        status: subscription.status,
        updatedAt: subscription.updatedAt,
      },
      data: subscriptionData,
    })
    if (updated.count !== 1) throw new SubscriptionTransitionConflictError()

    await tx.business.update({
      where: { id: subscription.businessId },
      data: {
        ...(derived.businessData ?? {}),
        ...(recovery ? { planId: recovery.planId } : {}),
        subscriptionStatus: derived.nextStatus,
        ...('trialEndAt' in derived.changes
          ? { trialEndsAt: derived.changes.trialEndAt }
          : {}),
      },
    })

    if (input.command.type === 'admin_record_payment') {
      await tx.subscriptionPayment.create({
        data: {
          businessId: subscription.businessId,
          subscriptionId: subscription.id,
          amount: input.command.amount,
          currency: subscription.currency,
          status: 'approved',
          paymentMethod: 'manual',
          notes: input.command.notes,
          paidAt: input.command.paidAt,
          provider: 'manual',
          environment: null,
          createdByUserId: input.actor?.userId,
        },
      })
    }

    const log = await tx.subscriptionLog.create({
      data: {
        businessId: subscription.businessId,
        action: derived.auditAction ?? 'subscription_transitioned',
        beforeStatus: subscription.status,
        afterStatus: derived.nextStatus,
        beforePlanId: input.command.type === 'admin_change_plan' ? subscription.planId : undefined,
        afterPlanId: input.command.type === 'admin_change_plan' ? input.command.planId : undefined,
        adminUserId: input.actor?.userId,
        adminEmail: input.actor?.email,
        notes: input.actor?.notes,
      },
    })

    const notification = lifecycleNotification({ subscription, derived, command: transitionCommand })
    if (notification) {
      await queueSubscriptionNotification(notification.kind, {
        businessId: subscription.businessId,
        subscriptionId: subscription.id,
        effectiveDate: notification.effectiveDate,
        eventAt: notification.eventAt,
        availableAt: notification.eventAt,
        eventId: log.id,
      }, { prisma: tx, now: () => notification.eventAt })
    }

    return { applied: true, status: derived.nextStatus }
  })
}
