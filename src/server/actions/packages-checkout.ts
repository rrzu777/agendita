'use server'

import { z } from 'zod'
import { addMinutes, addDays } from 'date-fns'
import { prisma } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth/user'
import { checkRateLimit } from '@/lib/rate-limit'
import { findOrCreateCustomerInTx } from '@/lib/customers/find-or-create'
import { resolveOnlinePaymentAvailabilityForBusiness } from '@/lib/payments/factory'

const HOLD_MINUTES = 30

const createPurchaseSchema = z.object({
  packageProductId: z.string().min(1),
  name: z.string().min(1).max(120),
  phone: z.string().min(6).max(30),
  acceptedTerms: z.literal(true, { error: 'Debes aceptar los términos' }),
})

/**
 * Inicia la compra online de un paquete: clienta logueada, re-gatea
 * disponibilidad de pago online del negocio, vincula/crea su Customer
 * (costura email de sesión + sessionUser → visibilidad en /mi) y crea un
 * PackagePurchase 'pending'/'online' con snapshots de precio/cantidad y un
 * hold de 30 min. Reutiliza una compra pending viva del mismo producto en
 * vez de duplicar (reintentos del checkout).
 */
export async function createPackagePurchase(input: {
  packageProductId: string
  name: string
  phone: string
  acceptedTerms: boolean
}): Promise<{ purchaseId: string }> {
  const user = await getCurrentUser()
  if (!user) throw new Error('Debes iniciar sesión para comprar un paquete.')

  const limit = await checkRateLimit('create-package-purchase', 20, 60000, { userId: user.id })
  if (!limit.success) throw new Error('Demasiadas solicitudes. Intenta de nuevo en unos minutos.')

  const parsed = createPurchaseSchema.safeParse(input)
  if (!parsed.success) {
    throw new Error('Datos inválidos: ' + parsed.error.issues.map(i => i.message).join(', '))
  }

  const product = await prisma.packageProduct.findFirst({
    where: { id: input.packageProductId, isActive: true },
    include: { services: { select: { id: true } } },
  })
  if (!product) throw new Error('Paquete no disponible')

  const availability = await resolveOnlinePaymentAvailabilityForBusiness(product.businessId)
  if (!availability.available) {
    throw new Error(availability.reason || 'Pago online no disponible para este negocio.')
  }

  const now = new Date()
  const expiresAt = product.expiryDays ? addDays(now, product.expiryDays) : null

  const purchaseId = await prisma.$transaction(async (tx) => {
    const { customer } = await findOrCreateCustomerInTx(tx, {
      businessId: product.businessId,
      phone: input.phone,
      name: input.name,
      email: user.email ?? null, // verificado de sesión — load-bearing para /mi
      sessionUser: user,
    })

    const existing = await tx.packagePurchase.findFirst({
      where: {
        businessId: product.businessId,
        customerId: customer.id,
        packageProductId: product.id,
        status: 'pending',
        holdExpiresAt: { gte: now },
      },
      orderBy: { createdAt: 'desc' },
    })
    if (existing) return existing.id

    const created = await tx.packagePurchase.create({
      data: {
        businessId: product.businessId,
        customerId: customer.id,
        packageProductId: product.id,
        pricePaid: product.price,
        quantity: product.quantity,
        bonusQuantity: product.bonusQuantity,
        coversAll: product.appliesToAll,
        coveredServiceIds: product.appliesToAll ? [] : product.services.map(s => s.id),
        source: 'online',
        status: 'pending',
        holdExpiresAt: addMinutes(now, HOLD_MINUTES),
        expiresAt,
        createdByUserId: null,
      },
    })
    return created.id
  })

  return { purchaseId }
}

/**
 * Prefill del checkout para una clienta logueada. Email siempre de la sesión.
 */
export async function getPackageCheckoutPrefill(businessId: string): Promise<{
  email: string | null
  name: string
  phone: string
  hasCustomer: boolean
} | null> {
  const user = await getCurrentUser()
  if (!user) return null

  const customer = await prisma.customer.findFirst({
    where: { businessId, userId: user.id },
    select: { name: true, phone: true },
  })

  const metaName = typeof user.user_metadata?.name === 'string' ? user.user_metadata.name : ''
  return {
    email: user.email ?? null,
    name: customer?.name || metaName || '',
    phone: customer?.phone || '',
    hasCustomer: !!customer,
  }
}
