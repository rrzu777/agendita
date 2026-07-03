'use server'

import { prisma } from '@/lib/db'
import { revalidatePath } from 'next/cache'
import { Prisma } from '@prisma/client'
import { checkRateLimit } from '@/lib/rate-limit'
import { requireBusinessRole, ForbiddenError } from '@/lib/auth/server'
import { packageProductSchema, sellPackageSchema, computePackageRefund, perGrantRequestId } from '@/lib/packages/schema'
import { generateGrantCode } from '@/lib/loyalty/redeem'
import { normalizePhone } from '@/lib/customers/phone'

// ── helpers module-local ──────────────────────────────────────────────
const PACKAGE_MARKER_NAME = 'package-coverage'

/** Una Promotion marcador por negocio a la que apuntan los grants de paquete.
 *  triggerType 'granted' (para que release reactive el grant), free_service, appliesToAll,
 *  pointsCost null (excluida del catálogo de canje). Creada lazily. */
async function getOrCreatePackageMarkerPromotion(tx: Prisma.TransactionClient, businessId: string): Promise<string> {
  const existing = await tx.promotion.findFirst({
    where: { businessId, triggerType: 'granted', name: PACKAGE_MARKER_NAME, pointsCost: null },
    select: { id: true },
  })
  if (existing) return existing.id
  const created = await tx.promotion.create({
    data: {
      businessId, name: PACKAGE_MARKER_NAME, triggerType: 'granted',
      rewardType: 'free_service', rewardValue: 0, appliesToAll: true, isActive: true,
      metadata: { kind: 'package-coverage' } as Prisma.InputJsonValue,
    },
    select: { id: true },
  })
  return created.id
}

// ── CRUD de productos ─────────────────────────────────────────────────
export async function listPackageProducts() {
  const { businessId } = await requireBusinessRole(['owner', 'admin'])
  return prisma.packageProduct.findMany({
    where: { businessId }, orderBy: { createdAt: 'desc' },
    include: { services: { select: { id: true, name: true } }, _count: { select: { purchases: true } } },
  })
}

export async function upsertPackageProduct(data: unknown, id?: string) {
  const { businessId, user } = await requireBusinessRole(['owner', 'admin'])
  const limit = await checkRateLimit('package-product', 30, 60000, { userId: user.id, businessId })
  if (!limit.success) throw new Error('Demasiadas solicitudes. Intenta más tarde.')
  const parsed = packageProductSchema.safeParse(data)
  if (!parsed.success) throw new Error('Datos inválidos: ' + parsed.error.issues.map(i => i.message).join(', '))
  const d = parsed.data
  if (!d.appliesToAll && d.serviceIds.length) {
    const count = await prisma.service.count({ where: { id: { in: d.serviceIds }, businessId } })
    if (count !== d.serviceIds.length) throw new Error('Servicio inválido')
  }
  const scalars = {
    name: d.name, quantity: d.quantity, bonusQuantity: d.bonusQuantity, price: d.price,
    expiryDays: d.expiryDays, appliesToAll: d.appliesToAll, isActive: d.isActive,
  }
  if (id) {
    const existing = await prisma.packageProduct.findFirst({ where: { id, businessId }, select: { id: true } })
    if (!existing) throw new ForbiddenError('Paquete no encontrado')
    await prisma.packageProduct.update({
      where: { id },
      data: { ...scalars, updatedByUserId: user.id,
        services: d.appliesToAll ? { set: [] } : { set: d.serviceIds.map(sid => ({ id: sid })) } },
    })
  } else {
    await prisma.packageProduct.create({
      data: { businessId, ...scalars, createdByUserId: user.id,
        services: d.appliesToAll ? undefined : { connect: d.serviceIds.map(sid => ({ id: sid })) } },
    })
  }
  await revalidatePath('/dashboard/paquetes')
}

export async function archivePackageProduct(id: string) {
  const { businessId } = await requireBusinessRole(['owner', 'admin'])
  const existing = await prisma.packageProduct.findFirst({ where: { id, businessId }, select: { id: true } })
  if (!existing) throw new ForbiddenError('Paquete no encontrado')
  await prisma.packageProduct.update({ where: { id }, data: { isActive: false } })
  await revalidatePath('/dashboard/paquetes')
}

// ── vender ────────────────────────────────────────────────────────────
export async function sellPackage(data: unknown) {
  const { businessId, user } = await requireBusinessRole(['owner', 'admin'])
  const limit = await checkRateLimit('package-sell', 30, 60000, { userId: user.id, businessId })
  if (!limit.success) throw new Error('Demasiadas solicitudes. Intenta más tarde.')
  const parsed = sellPackageSchema.safeParse(data)
  if (!parsed.success) throw new Error('Datos inválidos')
  const d = parsed.data

  const [product, customer] = await Promise.all([
    prisma.packageProduct.findFirst({
      where: { id: d.packageProductId, businessId, isActive: true },
      include: { services: { select: { id: true } } },
    }),
    prisma.customer.findFirst({ where: { id: d.customerId, businessId }, select: { id: true } }),
  ])
  if (!product) throw new Error('Paquete no disponible')
  if (!customer) throw new ForbiddenError('Clienta no encontrada')

  const now = new Date()
  const expiresAt = product.expiryDays ? new Date(now.getTime() + product.expiryDays * 86_400_000) : null
  const total = product.quantity + product.bonusQuantity

  try {
    await prisma.$transaction(async (tx) => {
      const markerId = await getOrCreatePackageMarkerPromotion(tx, businessId)
      const purchase = await tx.packagePurchase.create({
        data: {
          businessId, customerId: customer.id, packageProductId: product.id,
          pricePaid: product.price, quantity: product.quantity, bonusQuantity: product.bonusQuantity,
          coversAll: product.appliesToAll, coveredServiceIds: product.services.map(s => s.id),
          source: 'manual', paymentMethod: d.paymentMethod, paidAt: now, status: 'active',
          expiresAt, createdByUserId: user.id,
        },
      })
      for (let i = 0; i < total; i++) {
        await tx.promotionGrant.create({
          data: {
            businessId, promotionId: markerId, customerId: customer.id,
            code: await generateGrantCode(tx, businessId), pointsSpent: 0, status: 'active',
            expiresAt, refundOnExpiry: false, forfeitOnNoShow: false,
            requestId: perGrantRequestId(d.requestId, i), packagePurchaseId: purchase.id,
            createdByUserId: user.id,
          },
        })
      }
    })
  } catch (e) {
    // Reintento idempotente: si los grants ya existían por este requestId (P2002 en
    // @@unique([customerId, requestId])), la venta ya ocurrió → no-op.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      await revalidatePath('/dashboard/customers/' + customer.id)
      return
    }
    throw e
  }
  await revalidatePath('/dashboard/customers/' + customer.id)
}

// ── reembolsar ──────────────────────────────────────────────────────────
export async function refundPackagePurchase(purchaseId: string) {
  const { businessId } = await requireBusinessRole(['owner', 'admin'])
  const limit = await checkRateLimit('package-refund', 30, 60000, { businessId })
  if (!limit.success) throw new Error('Demasiadas solicitudes. Intenta más tarde.')
  const purchase = await prisma.packagePurchase.findFirst({
    where: { id: purchaseId, businessId },
    include: { _count: { select: { grants: { where: { status: 'active' } } } } },
  })
  if (!purchase) throw new ForbiddenError('Compra no encontrada')
  if (purchase.status === 'refunded') return // idempotente
  const unused = purchase._count.grants
  const refund = computePackageRefund({
    pricePaid: purchase.pricePaid, quantity: purchase.quantity,
    bonusQuantity: purchase.bonusQuantity, unusedSessions: unused,
  })
  await prisma.$transaction(async (tx) => {
    await tx.promotionGrant.updateMany({
      where: { packagePurchaseId: purchase.id, status: 'active' },
      data: { status: 'reversed', reversedAt: new Date() },
    })
    await tx.packagePurchase.update({
      where: { id: purchase.id },
      data: { status: 'refunded', refundedAt: new Date(), refundedAmount: refund },
    })
  })
  await revalidatePath('/dashboard/customers/' + purchase.customerId)
}

// ── queries ─────────────────────────────────────────────────────────────
// PÚBLICA (funnel): sin auth, patrón previewPromotion, defensiva.
export async function getActivePackagesForCustomer(input: { businessId: string; phone: string; serviceId: string }): Promise<{ remaining: number }> {
  const limit = await checkRateLimit('preview-promotion', 30, 60000)
  if (!limit.success) return { remaining: 0 }
  const normalized = normalizePhone(input.phone)
  if (!normalized) return { remaining: 0 }
  const customer = await prisma.customer.findFirst({ where: { businessId: input.businessId, phone: normalized }, select: { id: true } })
  if (!customer) return { remaining: 0 }
  const now = new Date()
  const remaining = await prisma.promotionGrant.count({
    where: {
      businessId: input.businessId, customerId: customer.id, status: 'active', packagePurchaseId: { not: null },
      OR: [{ expiresAt: null }, { expiresAt: { gte: now } }],
      packagePurchase: { status: 'active', OR: [{ coversAll: true }, { coveredServiceIds: { has: input.serviceId } }] },
    },
  })
  return { remaining }
}

// OWNER (panel de clienta)
export async function getCustomerPackages(customerId: string) {
  const { businessId } = await requireBusinessRole(['owner', 'admin'])
  const now = new Date()
  return prisma.packagePurchase.findMany({
    where: { businessId, customerId },
    orderBy: { createdAt: 'desc' },
    include: {
      product: { select: { name: true } },
      _count: { select: { grants: { where: { status: 'active', OR: [{ expiresAt: null }, { expiresAt: { gte: now } }] } } } },
    },
  })
}
