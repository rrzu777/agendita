'use server'

import { prisma } from '@/lib/db'
import { formatMoney } from '@/lib/money'
import { requirePlatformAdminUser } from '@/lib/auth/user'
import { applySubscriptionTransition } from '@/lib/subscriptions/transition'

function actor(user: { id: string; email?: string | null }, notes: string) {
  return {
    userId: user.id,
    email: user.email ?? undefined,
    notes,
  }
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
    command: { type: 'admin_change_plan', planId, planName: plan.name },
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
