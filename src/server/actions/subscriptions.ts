'use server'

import { prisma } from '@/lib/db'
import { requireBusinessRole } from '@/lib/auth/server'
import type { SubscriptionStatus } from '@prisma/client'

export async function getCurrentSubscription() {
  const { businessId } = await requireBusinessRole(['owner', 'admin'])
  return getSubscriptionByBusinessId(businessId)
}

export async function getSubscriptionByBusinessId(businessId: string) {
  const [subscription, payments] = await Promise.all([
    prisma.businessSubscription.findFirst({
      where: { businessId },
      include: { plan: true },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.subscriptionPayment.findMany({
      where: { businessId },
      orderBy: { createdAt: 'desc' },
      take: 20,
    }),
  ])

  return { subscription, payments }
}

export async function getBusinessSubscriptionStatus(businessId: string): Promise<{
  canReceiveBookings: boolean
  isSuspended: boolean
  isPastDue: boolean
  status: SubscriptionStatus | null
}> {
  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: { subscriptionStatus: true },
  })

  if (!business) {
    return { canReceiveBookings: false, isSuspended: false, isPastDue: false, status: null }
  }

  const status = business.subscriptionStatus

  return {
    canReceiveBookings: status !== 'suspended' && status !== 'cancelled',
    isSuspended: status === 'suspended',
    isPastDue: status === 'past_due',
    status,
  }
}
