import {
  Prisma,
  type PrismaClient,
  type SubscriptionStatus as PrismaSubscriptionStatus,
} from '@prisma/client'
import {
  deriveSubscriptionTransition,
  type DerivedSubscriptionTransition,
  type SubscriptionCommand,
  type SubscriptionState,
} from './state-machine'
import { systemBillingClock, type BillingClock } from './clock'

type TransitionActor = {
  userId?: string
  email?: string
  notes?: string
}

type ProviderPayment = {
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
  | { type: 'admin_change_plan'; planId: string; planName: string }
  | { type: 'admin_mark_past_due'; occurredAt: Date }
  | { type: 'admin_cancel'; occurredAt: Date; reason?: string }

export type ApplySubscriptionTransitionCommand = {
  subscriptionId?: string
  businessId?: string
  command: SubscriptionCommand | AdminSubscriptionCommand
  payment?: ProviderPayment
  actor?: TransitionActor
  clock?: BillingClock
}

export class SubscriptionTransitionConflictError extends Error {
  constructor() {
    super('La suscripción cambió durante la transición; reintente con el estado actual')
    this.name = 'SubscriptionTransitionConflictError'
  }
}

function toState(subscription: {
  status: PrismaSubscriptionStatus
  currentPeriodStart: Date
  currentPeriodEnd: Date
  trialStartAt: Date | null
  trialEndAt: Date | null
  cancelledAt: Date | null
  suspendedAt: Date | null
  suspendedReason: string | null
  nextBillingAt: Date | null
  lastPaidAt: Date | null
  pastDueAt: Date | null
  graceEndsAt: Date | null
  graceDays: number
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
        changes: { lastPaidAt: command.paidAt, pastDueAt: null, graceEndsAt: null },
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
        changes: { trialEndAt, currentPeriodEnd: trialEndAt },
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
        },
        auditAction: 'marked_past_due_by_admin',
        ignored: false,
      }
    case 'admin_cancel':
      return {
        nextStatus: 'cancelled',
        changes: { cancelledAt: command.occurredAt, nextBillingAt: null },
        auditAction: 'subscription_cancelled_by_admin',
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

    let paymentAlreadyApplied = false
    if (input.command.type === 'invoice_approved') {
      if (subscription.provider !== 'mercado_pago' || !subscription.environment) {
        throw new Error('Un pago externo requiere proveedor Mercado Pago y ambiente')
      }
      const existingPayment = await tx.subscriptionPayment.findUnique({
        where: {
          provider_environment_providerPaymentId: {
            provider: subscription.provider,
            environment: subscription.environment,
            providerPaymentId: input.command.providerPaymentId,
          },
        },
        select: { subscriptionId: true },
      })
      if (existingPayment && existingPayment.subscriptionId !== subscription.id) {
        throw new Error('El pago externo ya pertenece a otra suscripción')
      }
      paymentAlreadyApplied = Boolean(existingPayment)
    }

    const before = toState(subscription)
    const derived: DerivedSubscriptionTransition & {
      subscriptionData?: Prisma.BusinessSubscriptionUncheckedUpdateManyInput
      businessData?: Prisma.BusinessUncheckedUpdateInput
    } = isAdminCommand(input.command)
      ? adminTransition(before, input.command)
      : deriveSubscriptionTransition({
          subscription: before,
          command: input.command,
          clock: input.clock ?? systemBillingClock,
          paymentAlreadyApplied,
        })

    if (derived.ignored) {
      return { applied: false, status: subscription.status }
    }

    const subscriptionData: Prisma.BusinessSubscriptionUncheckedUpdateManyInput = {
      ...derived.changes,
      ...(derived.subscriptionData ?? {}),
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
    if (updated.count !== 1) {
      if (input.command.type === 'invoice_approved' && subscription.environment) {
        const concurrentPayment = await tx.subscriptionPayment.findUnique({
          where: {
            provider_environment_providerPaymentId: {
              provider: subscription.provider,
              environment: subscription.environment,
              providerPaymentId: input.command.providerPaymentId,
            },
          },
          select: { subscriptionId: true },
        })
        if (concurrentPayment?.subscriptionId === subscription.id) {
          const latest = await tx.businessSubscription.findUnique({
            where: { id: subscription.id },
            select: { status: true },
          })
          return { applied: false, status: latest?.status ?? subscription.status }
        }
      }
      throw new SubscriptionTransitionConflictError()
    }

    await tx.business.update({
      where: { id: subscription.businessId },
      data: {
        ...(derived.businessData ?? {}),
        subscriptionStatus: derived.nextStatus,
      },
    })

    if (input.command.type === 'invoice_approved') {
      const environment = subscription.environment
      if (!environment) throw new Error('El pago externo no tiene ambiente')
      await tx.subscriptionPayment.upsert({
        where: {
          provider_environment_providerPaymentId: {
            provider: subscription.provider,
            environment,
            providerPaymentId: input.command.providerPaymentId,
          },
        },
        update: {},
        create: {
          businessId: subscription.businessId,
          subscriptionId: subscription.id,
          amount: subscription.amount,
          currency: subscription.currency,
          status: 'approved',
          paidAt: input.command.paidAt,
          provider: subscription.provider,
          environment,
          providerPaymentId: input.command.providerPaymentId,
          providerInvoiceId: input.payment?.providerInvoiceId,
          providerStatus: input.payment?.providerStatus,
          providerUpdatedAt: input.payment?.providerUpdatedAt,
          rawPayload: input.payment?.safeMetadata,
        },
      })
    } else if (input.command.type === 'admin_record_payment') {
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

    await tx.subscriptionLog.create({
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

    return { applied: true, status: derived.nextStatus }
  })
}
