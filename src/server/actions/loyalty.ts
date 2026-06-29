'use server'

import { prisma } from '@/lib/db'
import { revalidatePath } from 'next/cache'
import { checkRateLimit } from '@/lib/rate-limit'
import { requireBusiness, requireBusinessRole, ForbiddenError } from '@/lib/auth/server'
import { loyaltyConfigSchema, adjustPointsSchema } from '@/lib/loyalty/schema'
import { getLoyaltyBalance, getLoyaltyHistory } from '@/lib/loyalty/balance'

export async function getLoyaltyConfig() {
  const { businessId } = await requireBusiness()
  return prisma.loyaltyConfig.findUnique({ where: { businessId } })
}

export async function upsertLoyaltyConfig(data: unknown) {
  const { businessId, user } = await requireBusinessRole(['owner', 'admin'])
  const limit = await checkRateLimit('loyalty-config', 30, 60000)
  if (!limit.success) throw new Error('Demasiadas solicitudes. Intenta más tarde.')

  const parsed = loyaltyConfigSchema.safeParse(data)
  if (!parsed.success) {
    throw new Error('Datos inválidos: ' + parsed.error.issues.map((i) => i.message).join(', '))
  }
  const d = parsed.data
  const saved = await prisma.loyaltyConfig.upsert({
    where: { businessId },
    create: { businessId, ...d, updatedByUserId: user.id },
    update: { ...d, updatedByUserId: user.id },
  })
  await revalidatePath('/dashboard/fidelizacion')
  return saved
}

export async function getCustomerLoyalty(customerId: string) {
  const { businessId } = await requireBusinessRole(['owner', 'admin'])
  const customer = await prisma.customer.findFirst({ where: { id: customerId, businessId }, select: { id: true } })
  if (!customer) throw new ForbiddenError('Clienta no encontrada')
  const [balance, history] = await Promise.all([
    getLoyaltyBalance(prisma, customerId),
    getLoyaltyHistory(prisma, customerId, 50),
  ])
  return { balance, history }
}

export async function adjustCustomerPoints(customerId: string, delta: unknown, note: unknown) {
  const { businessId, user } = await requireBusinessRole(['owner', 'admin'])
  const limit = await checkRateLimit('loyalty-adjust', 30, 60000)
  if (!limit.success) throw new Error('Demasiadas solicitudes. Intenta más tarde.')

  const parsed = adjustPointsSchema.safeParse({ delta, note })
  if (!parsed.success) {
    throw new Error('Datos inválidos: ' + parsed.error.issues.map((i) => i.message).join(', '))
  }
  const customer = await prisma.customer.findFirst({ where: { id: customerId, businessId }, select: { id: true } })
  if (!customer) throw new ForbiddenError('Clienta no encontrada')

  // sum + insert en la MISMA tx para evitar TOCTOU en el chequeo de saldo >= 0.
  await prisma.$transaction(async (tx) => {
    const agg = await tx.loyaltyLedger.aggregate({ where: { customerId }, _sum: { points: true } })
    const balance = agg._sum.points ?? 0
    if (balance + parsed.data.delta < 0) {
      throw new Error('El ajuste dejaría el saldo en negativo')
    }
    await tx.loyaltyLedger.create({
      data: {
        businessId, customerId, points: parsed.data.delta, reason: 'adjustment',
        note: parsed.data.note, createdByUserId: user.id,
        metadata: { previousBalance: balance },
      },
    })
  })
  await revalidatePath(`/dashboard/customers/${customerId}`)
}
