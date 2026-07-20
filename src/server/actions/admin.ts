'use server'

import { prisma } from '@/lib/db'
import { formatMoney } from '@/lib/money'
import { requirePlatformAdminUser } from '@/lib/auth/user'

export async function adminRecordSubscriptionPayment(
  businessId: string,
  amount: number,
  notes?: string
) {
  const user = await requirePlatformAdminUser()

  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('El monto debe ser un número positivo')
  }

  const subscription = await prisma.businessSubscription.findFirst({
    where: { businessId },
    orderBy: { createdAt: 'desc' },
  })

  if (!subscription) {
    throw new Error('No se encontró suscripción para este negocio')
  }

  const currentStatus = subscription.status

  await prisma.$transaction([
    prisma.subscriptionPayment.create({
      data: {
        businessId,
        subscriptionId: subscription.id,
        amount,
        currency: 'CLP',
        status: 'approved',
        paymentMethod: 'manual',
        notes: notes ?? null,
        paidAt: new Date(),
      },
    }),
    prisma.businessSubscription.update({
      where: { id: subscription.id },
      data: { status: 'active' },
    }),
    prisma.business.update({
      where: { id: businessId },
      data: { subscriptionStatus: 'active' },
    }),
    prisma.subscriptionLog.create({
      data: {
        businessId,
        action: 'payment_recorded_by_admin',
        beforeStatus: currentStatus,
        afterStatus: 'active',
        adminUserId: user.id,
        adminEmail: user.email,
        notes: `Pago manual registrado por admin: ${formatMoney(amount)}${notes ? ` — ${notes}` : ''}`,
      },
    }),
  ])
}

export async function adminExtendTrial(businessId: string, days: number) {
  const user = await requirePlatformAdminUser()

  if (!Number.isFinite(days) || days < 1 || days > 365) {
    throw new Error('Los días de extensión deben ser un número entre 1 y 365')
  }

  const subscription = await prisma.businessSubscription.findFirst({
    where: { businessId },
    orderBy: { createdAt: 'desc' },
  })

  if (!subscription) {
    throw new Error('No se encontró suscripción')
  }

  const newEndDate = new Date(
    Math.max(
      (subscription.trialEndAt?.getTime() ?? Date.now()),
      Date.now()
    ) + days * 24 * 60 * 60 * 1000
  )

  const beforeStatus = subscription.status

  await prisma.$transaction([
    prisma.businessSubscription.update({
      where: { id: subscription.id },
      data: {
        trialEndAt: newEndDate,
        currentPeriodEnd: newEndDate,
        status: 'trialing',
      },
    }),
    prisma.business.update({
      where: { id: businessId },
      data: {
        subscriptionStatus: 'trialing',
        trialEndsAt: newEndDate,
      },
    }),
    prisma.subscriptionLog.create({
      data: {
        businessId,
        action: 'trial_extended_by_admin',
        beforeStatus,
        afterStatus: 'trialing',
        adminUserId: user.id,
        adminEmail: user.email,
        notes: `Admin extendió trial ${days} días hasta ${newEndDate.toISOString()}`,
      },
    }),
  ])
}

export async function adminSuspendBusiness(businessId: string, reason?: string) {
  const user = await requirePlatformAdminUser()

  const subscription = await prisma.businessSubscription.findFirst({
    where: { businessId },
    orderBy: { createdAt: 'desc' },
  })

  if (!subscription) {
    throw new Error('No se encontró suscripción para este negocio')
  }

  const beforeStatus = subscription.status

  await prisma.$transaction([
    prisma.businessSubscription.updateMany({
      where: { businessId },
      data: {
        status: 'suspended',
        suspendedAt: new Date(),
        suspendedReason: reason ?? null,
      },
    }),
    prisma.business.update({
      where: { id: businessId },
      data: { subscriptionStatus: 'suspended' },
    }),
    prisma.subscriptionLog.create({
      data: {
        businessId,
        action: 'business_suspended_by_admin',
        beforeStatus,
        afterStatus: 'suspended',
        adminUserId: user.id,
        adminEmail: user.email,
        notes: reason ?? 'Suspendido por admin',
      },
    }),
  ])
}

export async function adminActivateBusiness(businessId: string) {
  const user = await requirePlatformAdminUser()

  const subscription = await prisma.businessSubscription.findFirst({
    where: { businessId },
    orderBy: { createdAt: 'desc' },
  })

  if (!subscription) {
    throw new Error('No se encontró suscripción para este negocio')
  }

  const beforeStatus = subscription.status

  await prisma.$transaction([
    prisma.businessSubscription.updateMany({
      where: { businessId },
      data: {
        status: 'active',
        suspendedAt: null,
        suspendedReason: null,
      },
    }),
    prisma.business.update({
      where: { id: businessId },
      data: { subscriptionStatus: 'active' },
    }),
    prisma.subscriptionLog.create({
      data: {
        businessId,
        action: 'business_activated_by_admin',
        beforeStatus,
        afterStatus: 'active',
        adminUserId: user.id,
        adminEmail: user.email,
        notes: 'Reactivado por admin',
      },
    }),
  ])
}

export async function adminChangePlan(businessId: string, planId: string) {
  const user = await requirePlatformAdminUser()

  if (!planId || typeof planId !== 'string') {
    throw new Error('planId es requerido')
  }

  const plan = await prisma.plan.findUnique({ where: { id: planId } })
  if (!plan) {
    throw new Error('El plan no existe')
  }

  const subscription = await prisma.businessSubscription.findFirst({
    where: { businessId },
    orderBy: { createdAt: 'desc' },
  })

  if (!subscription) {
    throw new Error('No se encontró suscripción para este negocio')
  }

  const beforeStatus = subscription.status
  const beforePlanId = subscription.planId

  await prisma.$transaction([
    prisma.businessSubscription.updateMany({
      where: { businessId },
      data: { planId },
    }),
    prisma.business.update({
      where: { id: businessId },
      data: { planId },
    }),
    prisma.subscriptionLog.create({
      data: {
        businessId,
        action: 'plan_changed_by_admin',
        beforeStatus,
        afterStatus: beforeStatus,
        beforePlanId,
        afterPlanId: planId,
        adminUserId: user.id,
        adminEmail: user.email,
        notes: `Plan cambiado a "${plan.name}" por admin`,
      },
    }),
  ])
}

export async function adminMarkPastDue(businessId: string) {
  const user = await requirePlatformAdminUser()

  const subscription = await prisma.businessSubscription.findFirst({
    where: { businessId },
    orderBy: { createdAt: 'desc' },
  })

  if (!subscription) {
    throw new Error('No se encontró suscripción para este negocio')
  }

  const beforeStatus = subscription.status

  await prisma.$transaction([
    prisma.businessSubscription.updateMany({
      where: { businessId },
      data: { status: 'past_due' },
    }),
    prisma.business.update({
      where: { id: businessId },
      data: { subscriptionStatus: 'past_due' },
    }),
    prisma.subscriptionLog.create({
      data: {
        businessId,
        action: 'marked_past_due_by_admin',
        beforeStatus,
        afterStatus: 'past_due',
        adminUserId: user.id,
        adminEmail: user.email,
        notes: 'Marcado como pago pendiente por admin',
      },
    }),
  ])
}

export async function adminCancelSubscription(businessId: string, reason?: string) {
  const user = await requirePlatformAdminUser()

  const subscription = await prisma.businessSubscription.findFirst({
    where: { businessId },
    orderBy: { createdAt: 'desc' },
  })

  if (!subscription) {
    throw new Error('No se encontró suscripción para este negocio')
  }

  const beforeStatus = subscription.status

  await prisma.$transaction([
    prisma.businessSubscription.updateMany({
      where: { businessId },
      data: {
        status: 'cancelled',
        cancelledAt: new Date(),
      },
    }),
    prisma.business.update({
      where: { id: businessId },
      data: { subscriptionStatus: 'cancelled' },
    }),
    prisma.subscriptionLog.create({
      data: {
        businessId,
        action: 'subscription_cancelled_by_admin',
        beforeStatus,
        afterStatus: 'cancelled',
        adminUserId: user.id,
        adminEmail: user.email,
        notes: reason ?? 'Suscripción cancelada por admin',
      },
    }),
  ])
}
