'use server'

import { prisma } from '@/lib/db'
import { formatMoney } from '@/lib/money'
import { requirePlatformAdminUser } from '@/lib/auth/user'
import { applySubscriptionTransition } from '@/lib/subscriptions/transition'
import { reconcileSubscription } from '@/lib/subscriptions/reconciliation'
import { revalidatePath } from 'next/cache'
import { formatInTimeZone } from 'date-fns-tz'
import { UserError } from '@/lib/actions/result'

function actor(user: { id: string; email?: string | null }, notes: string) {
  return {
    userId: user.id,
    email: user.email ?? undefined,
    notes,
  }
}

type BillingConfiguration = {
  planId: string
  trialDays: number
  graceDays: number
  billingEnabled: boolean
}

function requiredReason(reason: string): string {
  const normalized = reason.trim()
  if (!normalized) throw new Error('El motivo es obligatorio')
  return normalized
}

function assertIntegerRange(value: number, min: number, max: number, label: string) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${label} debe ser un entero entre ${min} y ${max}`)
  }
}

function revalidateAdminBusiness(businessId: string) {
  revalidatePath(`/admin/businesses/${businessId}`)
}

function endOfBusinessDate(dateOnly: string, timezone: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateOnly)
  if (!match) throw new Error('La fecha debe usar el formato YYYY-MM-DD')
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(new Date())
  } catch {
    throw new Error('La zona horaria del negocio no es válida')
  }
  const [, yearText, monthText, dayText] = match
  const year = Number(yearText)
  const month = Number(monthText)
  const day = Number(dayText)
  const civilDate = new Date(Date.UTC(year, month - 1, day))
  if (
    civilDate.getUTCFullYear() !== year ||
    civilDate.getUTCMonth() !== month - 1 ||
    civilDate.getUTCDate() !== day
  ) {
    throw new Error('La fecha no es válida')
  }
  civilDate.setUTCDate(civilDate.getUTCDate() + 1)
  const anchor = civilDate.getTime()
  const formattedDate = (instant: number) =>
    formatInTimeZone(new Date(instant), timezone, 'yyyy-MM-dd')

  let lower: number
  let upper: number
  let step = 1
  if (formattedDate(anchor) > dateOnly) {
    upper = anchor
    lower = anchor - step
    while (formattedDate(lower) > dateOnly) {
      upper = lower
      step *= 2
      lower = anchor - step
    }
  } else {
    lower = anchor
    upper = anchor + step
    while (formattedDate(upper) <= dateOnly) {
      lower = upper
      step *= 2
      upper = anchor + step
    }
  }
  while (upper - lower > 1) {
    const middle = lower + Math.floor((upper - lower) / 2)
    if (formattedDate(middle) > dateOnly) upper = middle
    else lower = middle
  }
  return new Date(upper - 1)
}

export async function adminSetComplimentaryPeriod(
  businessId: string,
  complimentaryDate: string,
  reason: string,
) {
  const user = await requirePlatformAdminUser()
  const notes = requiredReason(reason)
  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: { timezone: true },
  })
  if (!business) throw new Error('No se encontró el negocio')
  const complimentaryUntil = endOfBusinessDate(complimentaryDate, business.timezone)
  if (complimentaryDate <= formatInTimeZone(new Date(), business.timezone, 'yyyy-MM-dd')) {
    throw new Error('La fecha de exención debe ser futura')
  }
  await applySubscriptionTransition(prisma, {
    businessId,
    command: { type: 'admin_set_complimentary', complimentaryUntil, reason: notes },
    actor: actor(user, notes),
  })
  revalidateAdminBusiness(businessId)
}

export async function adminClearComplimentaryPeriod(businessId: string, reason: string) {
  const user = await requirePlatformAdminUser()
  const notes = requiredReason(reason)
  await applySubscriptionTransition(prisma, {
    businessId,
    command: { type: 'admin_clear_complimentary', occurredAt: new Date() },
    actor: actor(user, notes),
  })
  revalidateAdminBusiness(businessId)
}

export async function adminConfigureBilling(businessId: string, configuration: BillingConfiguration) {
  const user = await requirePlatformAdminUser()
  assertIntegerRange(configuration.trialDays, 0, 365, 'trialDays')
  assertIntegerRange(configuration.graceDays, 0, 30, 'Los días de gracia')
  if (!configuration.planId?.trim()) throw new Error('El plan es obligatorio')

  const now = new Date()
  const plan = await prisma.$transaction(async (tx) => {
    const selectedPlan = await tx.plan.findUnique({ where: { id: configuration.planId } })
    if (!selectedPlan) throw new Error('El plan no existe')
    const subscription = await tx.businessSubscription.findFirst({
      where: { businessId },
      orderBy: { createdAt: 'desc' },
    })
    if (!subscription) throw new Error('No se encontró suscripción para este negocio')
    if (subscription.providerSubscriptionId && subscription.planId !== selectedPlan.id) {
      throw new Error('No se puede cambiar el plan contratado mientras exista una autorización externa')
    }
    const updated = await tx.businessSubscription.updateMany({
      where: {
        id: subscription.id,
        updatedAt: subscription.updatedAt,
        ...(!configuration.billingEnabled ? {
          OR: [
            { billingCronClaimedUntil: null },
            { billingCronClaimedUntil: { lte: now } },
          ],
        } : {}),
      },
      data: {
        planId: selectedPlan.id,
        amount: selectedPlan.priceMonthly,
        trialDays: configuration.trialDays,
        graceDays: configuration.graceDays,
        billingEnabled: configuration.billingEnabled,
      },
    })
    if (updated.count !== 1) {
      if (!configuration.billingEnabled) {
        const current = await tx.businessSubscription.findUnique({
          where: { id: subscription.id }, select: { billingCronClaimedUntil: true },
        })
        if (current?.billingCronClaimedUntil && current.billingCronClaimedUntil > now) {
          throw new UserError('La facturación está procesando este negocio; espera unos segundos e intenta nuevamente')
        }
      }
      throw new Error('La suscripción cambió; recarga e intenta nuevamente')
    }
    await tx.business.update({ where: { id: businessId }, data: { planId: selectedPlan.id } })
    await tx.subscriptionLog.create({
      data: {
        businessId,
        action: 'billing_configuration_updated',
        beforeStatus: subscription.status,
        afterStatus: subscription.status,
        beforePlanId: subscription.planId,
        afterPlanId: selectedPlan.id,
        adminUserId: user.id,
        adminEmail: user.email ?? undefined,
        notes: `Plan ${selectedPlan.name}; trial ${configuration.trialDays} días; gracia ${configuration.graceDays} días; rollout ${configuration.billingEnabled ? 'habilitado' : 'deshabilitado'}`,
      },
    })
    return selectedPlan
  })
  revalidateAdminBusiness(businessId)
  return { planId: plan.id, billingEnabled: configuration.billingEnabled }
}

export async function adminReconcileSubscription(businessId: string) {
  const user = await requirePlatformAdminUser()
  const subscription = await prisma.businessSubscription.findFirst({
    where: { businessId },
    select: { id: true },
    orderBy: { createdAt: 'desc' },
  })
  if (!subscription) throw new Error('No se encontró suscripción para este negocio')

  const requestLog = await prisma.$transaction((tx) => tx.subscriptionLog.create({
    data: {
      businessId,
      action: 'subscription_reconciliation_requested',
      adminUserId: user.id,
      adminEmail: user.email ?? undefined,
      notes: 'Reconciliación autoritativa solicitada por admin',
    },
  }))
  let result: Awaited<ReturnType<typeof reconcileSubscription>>
  try {
    result = await reconcileSubscription(subscription.id)
  } catch (error) {
    await prisma.$transaction((tx) => tx.subscriptionLog.create({ data: {
      businessId,
      action: 'subscription_reconciliation_failed',
      adminUserId: user.id,
      adminEmail: user.email ?? undefined,
      notes: `Solicitud ${requestLog.id}; proveedor no pudo completar la reconciliación`,
    } }))
    throw error
  }
  await prisma.$transaction((tx) => tx.subscriptionLog.create({ data: {
    businessId,
    action: 'subscription_reconciliation_succeeded',
    adminUserId: user.id,
    adminEmail: user.email ?? undefined,
    notes: `Solicitud ${requestLog.id}; ${result.invoices} facturas revisadas, ${result.applied} aplicadas`,
  } }))
  revalidateAdminBusiness(businessId)
  return result
}

export async function adminRecordSubscriptionPayment(
  businessId: string,
  amount: number,
  notes?: string,
) {
  const user = await requirePlatformAdminUser()

  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('El monto debe ser un número positivo')
  }

  const paidAt = new Date()
  await applySubscriptionTransition(prisma, {
    businessId,
    command: { type: 'admin_record_payment', amount, paidAt, notes },
    actor: actor(
      user,
      `Pago manual registrado por admin: ${formatMoney(amount, 'CLP')}${notes ? ` — ${notes}` : ''}`,
    ),
  })
}

export async function adminExtendTrial(businessId: string, days: number) {
  const user = await requirePlatformAdminUser()

  if (!Number.isFinite(days) || days < 1 || days > 365) {
    throw new Error('Los días de extensión deben ser un número entre 1 y 365')
  }

  await applySubscriptionTransition(prisma, {
    businessId,
    command: { type: 'admin_extend_trial', days, at: new Date() },
    actor: actor(user, `Admin extendió trial ${days} días`),
  })
}

export async function adminSuspendBusiness(businessId: string, reason?: string) {
  const user = await requirePlatformAdminUser()

  await applySubscriptionTransition(prisma, {
    businessId,
    command: { type: 'admin_suspend', occurredAt: new Date(), reason },
    actor: actor(user, reason ?? 'Suspendido por admin'),
  })
}

export async function adminActivateBusiness(businessId: string) {
  const user = await requirePlatformAdminUser()

  await applySubscriptionTransition(prisma, {
    businessId,
    command: { type: 'admin_activate', occurredAt: new Date() },
    actor: actor(user, 'Reactivado por admin'),
  })
}

export async function adminChangePlan(businessId: string, planId: string) {
  const user = await requirePlatformAdminUser()

  if (!planId || typeof planId !== 'string') {
    throw new Error('planId es requerido')
  }

  const plan = await prisma.plan.findUnique({ where: { id: planId } })
  if (!plan) throw new Error('El plan no existe')

  await applySubscriptionTransition(prisma, {
    businessId,
    command: { type: 'admin_change_plan', planId },
    actor: actor(user, `Plan cambiado a "${plan.name}" por admin`),
  })
}

export async function adminMarkPastDue(businessId: string) {
  const user = await requirePlatformAdminUser()

  await applySubscriptionTransition(prisma, {
    businessId,
    command: { type: 'admin_mark_past_due', occurredAt: new Date() },
    actor: actor(user, 'Marcado como pago pendiente por admin'),
  })
}

export async function adminCancelSubscription(businessId: string, reason?: string) {
  const user = await requirePlatformAdminUser()

  await applySubscriptionTransition(prisma, {
    businessId,
    command: { type: 'admin_cancel', occurredAt: new Date(), reason },
    actor: actor(user, reason ?? 'Suscripción cancelada por admin'),
  })
}
