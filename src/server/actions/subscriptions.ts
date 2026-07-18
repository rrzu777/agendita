'use server'

import { prisma } from '@/lib/db'
import { requireBusinessRole } from '@/lib/auth/server'

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
