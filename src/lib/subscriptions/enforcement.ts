import { prisma } from '@/lib/db'
import type { SubscriptionStatus } from '@prisma/client'

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

export function assertBusinessCanReceiveBookings(subscriptionStatus: SubscriptionStatus): void {
  if (subscriptionStatus === 'suspended' || subscriptionStatus === 'cancelled') {
    throw new Error(
      subscriptionStatus === 'suspended'
        ? 'Este negocio está temporalmente suspendido y no recibe nuevas reservas.'
        : 'Este negocio ya no acepta reservas.'
    )
  }
}

export function getSubscriptionStatusLabel(status: SubscriptionStatus): string {
  const labels: Record<SubscriptionStatus, string> = {
    trialing: 'En prueba',
    active: 'Activo',
    past_due: 'Pago pendiente',
    suspended: 'Suspendido',
    cancelled: 'Cancelado',
  }
  return labels[status] ?? status
}
