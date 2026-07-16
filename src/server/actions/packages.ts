'use server'

import { prisma } from '@/lib/db'
import { revalidatePath } from 'next/cache'
import { addDays } from 'date-fns'
import { Prisma } from '@prisma/client'
import { checkRateLimit } from '@/lib/rate-limit'
import { requireBusinessRole, ForbiddenError } from '@/lib/auth/server'
import { packageProductSchema, sellPackageSchema, computePackageRefund } from '@/lib/packages/schema'
import { normalizePhone } from '@/lib/customers/phone'
import { activatePackagePurchaseInTx } from '@/lib/packages/activate'
import { reversePackagePurchaseInTx } from '@/lib/packages/reverse'
import { pendingPackageTransferWhere, declaredPkgTransferPaymentWhere } from '@/lib/bank-transfer/declared'
import { getMercadoPagoProviderForBusiness } from '@/lib/payments/factory'
import { revalidateBusinessPublicPaths } from './revalidate-business'

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
  await revalidateBusinessPublicPaths(businessId)
}

export async function archivePackageProduct(id: string) {
  const { businessId } = await requireBusinessRole(['owner', 'admin'])
  const existing = await prisma.packageProduct.findFirst({ where: { id, businessId }, select: { id: true } })
  if (!existing) throw new ForbiddenError('Paquete no encontrado')
  await prisma.packageProduct.update({ where: { id }, data: { isActive: false } })
  await revalidatePath('/dashboard/paquetes')
  await revalidateBusinessPublicPaths(businessId)
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
  const expiresAt = product.expiryDays ? addDays(now, product.expiryDays) : null

  try {
    await prisma.$transaction(async (tx) => {
      const purchase = await tx.packagePurchase.create({
        data: {
          businessId, customerId: customer.id, packageProductId: product.id,
          pricePaid: product.price, quantity: product.quantity, bonusQuantity: product.bonusQuantity,
          coversAll: product.appliesToAll, coveredServiceIds: product.services.map(s => s.id),
          source: 'manual', paymentMethod: d.paymentMethod, paidAt: now, status: 'active',
          expiresAt, createdByUserId: user.id,
        },
      })
      await activatePackagePurchaseInTx(tx, purchase, { requestId: d.requestId, createdByUserId: user.id })
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
  // Sesiones no usadas = grants activos NO vencidos (consistente con getCustomerPackages
  // y getActivePackagesForCustomer). Los grants vencidos siguen en status 'active' (la
  // expiración es lazy), pero no tienen valor redimible, así que no se reembolsan.
  const now = new Date()
  const purchase = await prisma.packagePurchase.findFirst({
    where: { id: purchaseId, businessId },
    include: {
      _count: {
        select: {
          grants: { where: { status: 'active', OR: [{ expiresAt: null }, { expiresAt: { gte: now } }] } },
        },
      },
    },
  })
  if (!purchase) throw new ForbiddenError('Compra no encontrada')
  if (purchase.status === 'refunded') return // idempotente
  const unused = purchase._count.grants
  const refund = computePackageRefund({
    pricePaid: purchase.pricePaid, quantity: purchase.quantity,
    bonusQuantity: purchase.bonusQuantity, unusedSessions: unused,
  })

  // Payment que originó la compra (para saber si hay que devolver por MP).
  const payment = await prisma.payment.findFirst({
    where: { packagePurchaseId: purchase.id, paymentType: 'package_purchase' },
    orderBy: { createdAt: 'desc' },
  })

  // Refund REAL por MP: FUERA de la tx (I/O de red). Sólo si es online, hay id de MP y monto > 0.
  if (payment && payment.provider === 'mercado_pago' && payment.providerPaymentId && refund > 0) {
    const provider = await getMercadoPagoProviderForBusiness(businessId)
    const result = await provider.refundPayment({
      providerPaymentId: payment.providerPaymentId,
      amount: refund,
      currency: payment.currency,
      idempotencyKey: `refund:pkg:${purchase.id}`,
    })
    // Si MP no aceptó el reembolso, NO revertir localmente (evita marcar refunded
    // sin que el dinero se haya devuelto). 'pending' es aceptable (se acredita async).
    if (result.status === 'failed') {
      throw new Error('El reembolso en Mercado Pago no pudo procesarse. Intentá de nuevo o revisá en tu cuenta de Mercado Pago.')
    }
  }

  await prisma.$transaction(async (tx) => {
    await reversePackagePurchaseInTx(tx, purchase, {
      mode: 'voluntary',
      amount: refund,
      currency: payment?.currency ?? 'CLP',
      paymentId: payment?.id ?? null,
      now,
    })
    // El Payment de la compra queda 'refunded' (el núcleo sólo toca purchase/grants/ledger).
    // Sin esto totalPaidApproved sobreestima lo pagado y el pago se ve 'approved'.
    if (payment) {
      await tx.payment.updateMany({
        where: { id: payment.id, status: 'approved' },
        data: { status: 'refunded' },
      })
    }
  })

  revalidatePath('/dashboard/customers/' + purchase.customerId)
  revalidatePath('/dashboard/paquetes')
  await revalidateBusinessPublicPaths(businessId)
}

// ── queries ─────────────────────────────────────────────────────────────
// PÚBLICA (funnel): sin auth, patrón previewPromotion, defensiva.
export async function getActivePackagesForCustomer(input: { businessId: string; phone: string; serviceId: string }): Promise<{ remaining: number }> {
  // Balde de rate-limit propio (no compartir con previewPromotion) para que el uso
  // intensivo de una feature no agote la otra por IP.
  const limit = await checkRateLimit('preview-package', 30, 60000)
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
    where: { businessId, customerId, status: { in: ['active', 'refunded', 'pending', 'expired'] } },
    orderBy: { createdAt: 'desc' },
    include: {
      product: { select: { name: true } },
      _count: { select: { grants: { where: { status: 'active', OR: [{ expiresAt: null }, { expiresAt: { gte: now } }] } } } },
    },
  })
}

// OWNER (panel de transferencias de paquete pendientes)
export async function getPendingPackageTransfers() {
  const { businessId } = await requireBusinessRole(['owner', 'admin'])
  return prisma.packagePurchase.findMany({
    where: pendingPackageTransferWhere(businessId),
    orderBy: { createdAt: 'desc' },
    include: {
      product: { select: { name: true } },
      customer: { select: { name: true, phone: true } },
      payments: { where: declaredPkgTransferPaymentWhere, select: { id: true, providerPaymentId: true, createdAt: true } },
    },
  })
}

export async function getPackageSalesTotal(): Promise<number> {
  const { businessId } = await requireBusinessRole(['owner', 'admin'])
  // Fuente única: ledger. Ventas (package_sale) netas de reembolsos de paquete
  // (refund_issued con packagePurchaseId). Sin backfill del histórico de B4a.
  const [sales, refunds] = await Promise.all([
    prisma.ledgerEntry.aggregate({ _sum: { amount: true }, where: { businessId, type: 'package_sale' } }),
    prisma.ledgerEntry.aggregate({ _sum: { amount: true }, where: { businessId, type: 'refund_issued', packagePurchaseId: { not: null } } }),
  ])
  const net = (sales._sum.amount ?? 0) - (refunds._sum.amount ?? 0)
  // Clamp a 0 para no mostrar un KPI negativo. Un neto negativo señala un reembolso
  // sin venta que netear (típicamente un paquete legacy de B4a sin asiento package_sale);
  // lo logueamos para que no quede invisible.
  if (net < 0) {
    console.warn(`[getPackageSalesTotal] neto negativo (${net}) para business ${businessId} — reembolso sin package_sale que netear (¿legacy B4a?)`)
  }
  return Math.max(0, net)
}
