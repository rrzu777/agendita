'use server'

import { z } from 'zod'
import { addMinutes, addDays, addHours } from 'date-fns'
import { PaymentProvider, PaymentStatus, PaymentType } from '@prisma/client'
import { prisma } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth/user'
import { ensureUserRow, AccountConflictError } from '@/lib/auth/ensure-user-row'
import { checkRateLimit } from '@/lib/rate-limit'
import { findOrCreateCustomerInTx } from '@/lib/customers/find-or-create'
import {
  resolveOnlinePaymentAvailabilityForBusiness,
  getOnlinePaymentProviderForBusiness,
} from '@/lib/payments/factory'
import { createMpPreferenceForPayment, getPaymentAppUrl } from '@/lib/payments/create-preference'
import { getPackageConfirmationUrl } from '@/lib/business/urls'
import { applyApprovedPackagePayment } from '@/server/services/finance'
import { getBankTransferInfo } from '@/server/actions/bank-transfer-public'
import { btPkgDeclaredId } from '@/lib/bank-transfer/declared'
import { sendMultiNotificationSafely, sendPackageTransferDeclaredToBusiness } from '@/lib/notifications'

const HOLD_MINUTES = 30

const createPurchaseSchema = z.object({
  packageProductId: z.string().min(1),
  name: z.string().min(1).max(120),
  phone: z.string().min(6).max(30),
  acceptedTerms: z.literal(true, { error: 'Debes aceptar los términos' }),
  method: z.enum(['mp', 'transfer']).default('mp'),
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
  method?: 'mp' | 'transfer'
}): Promise<{ purchaseId: string }> {
  const user = await getCurrentUser()
  if (!user) throw new Error('Debes iniciar sesión para comprar un paquete.')

  // Primera compra de una clienta que nunca pasó por /mi: sin esto, la fila
  // User de Prisma no existe y linkCustomerFromBookingSession (Vía 3, FK
  // Customer.userId → User.id) hace no-op silencioso — la compra queda sin
  // dueña y initiatePackagePayment la rechaza como "no corresponde a tu
  // cuenta" en todos los reintentos. Mismo patrón que prepareMiUser.
  try {
    await ensureUserRow(user)
  } catch (e) {
    if (e instanceof AccountConflictError) throw new Error(e.message)
    throw e
  }

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

  const method = parsed.data.method

  // Gate por método: MP gatea disponibilidad de pago online; transferencia gatea
  // que el negocio tenga transferencia habilitada.
  let transferHoldHours: number | null = null
  if (method === 'transfer') {
    const transferInfo = await getBankTransferInfo(product.businessId)
    if (!transferInfo) throw new Error('Transferencia bancaria no disponible para este negocio.')
    transferHoldHours = transferInfo.holdHours
  } else {
    const availability = await resolveOnlinePaymentAvailabilityForBusiness(product.businessId)
    if (!availability.available) {
      throw new Error(availability.reason || 'Pago online no disponible para este negocio.')
    }
  }

  const now = new Date()
  const expiresAt = product.expiryDays ? addDays(now, product.expiryDays) : null
  const holdExpiresAt = transferHoldHours != null ? addHours(now, transferHoldHours) : addMinutes(now, HOLD_MINUTES)

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
    if (existing) {
      // Reintento (posible cambio de método): recalcular el hold al método actual.
      await tx.packagePurchase.update({ where: { id: existing.id }, data: { holdExpiresAt } })
      return existing.id
    }

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
        holdExpiresAt,
        expiresAt,
        createdByUserId: null,
      },
    })
    return created.id
  })

  return { purchaseId }
}

/** Prefill del checkout de paquete para una clienta logueada. */
export type PackageCheckoutPrefill = {
  email: string | null
  name: string
  phone: string
}

/**
 * Prefill del checkout para una clienta logueada. Email siempre de la sesión.
 */
export async function getPackageCheckoutPrefill(businessId: string): Promise<PackageCheckoutPrefill | null> {
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
  }
}

/** Carga la compra + valida que pertenece a la cuenta logueada (clienta dueña). */
async function loadOwnedPurchase(purchaseId: string, userId: string) {
  const purchase = await prisma.packagePurchase.findUnique({
    where: { id: purchaseId },
    include: {
      customer: { select: { userId: true, email: true, name: true } },
      product: { select: { name: true } },
      business: { select: { name: true, slug: true, subdomain: true, currency: true } },
    },
  })
  if (!purchase) throw new Error('Compra no encontrada')
  if (purchase.customer.userId !== userId) throw new Error('Esta compra no corresponde a tu cuenta.')
  return purchase
}

/**
 * Inicia el pago online de una compra de paquete (clienta logueada, dueña de
 * la compra). Pre-crea (o reutiliza, anti doble-click) un Payment local
 * 'pending' con paymentType 'package_purchase' y arma la preferencia MP vía
 * el tronco compartido `createMpPreferenceForPayment` (Task 5). Para un
 * provider sin redirect (mock/test) confirma server-side de inmediato.
 */
export async function initiatePackagePayment(input: { purchaseId: string }): Promise<
  { redirectUrl: string } | { confirmed: true }
> {
  const user = await getCurrentUser()
  if (!user) throw new Error('Debes iniciar sesión para pagar el paquete.')

  const limit = await checkRateLimit('initiate-package-payment', 20, 60000, { userId: user.id })
  if (!limit.success) throw new Error('Demasiadas solicitudes. Intenta de nuevo en unos minutos.')

  const purchase = await loadOwnedPurchase(input.purchaseId, user.id)
  if (purchase.status !== 'pending') {
    throw new Error('Esta compra ya fue procesada.')
  }

  const provider = await getOnlinePaymentProviderForBusiness(purchase.businessId)
  const currency = purchase.business.currency || 'CLP'

  // Evitar múltiples Payment pending por doble click: reusar si ya existe uno.
  // Scopeado por provider: si la clienta declaró una transferencia (Payment 'manual')
  // y ahora reintenta por MP, NO reusar ese Payment manual — el webhook lo rechazaría
  // por provider mismatch. Cada provider usa su propio Payment.
  const existingPending = await prisma.payment.findFirst({
    where: {
      packagePurchaseId: purchase.id,
      paymentType: PaymentType.package_purchase,
      status: PaymentStatus.pending,
      provider: provider.name as PaymentProvider,
    },
  })

  let localPaymentId: string
  if (existingPending) {
    localPaymentId = existingPending.id
  } else {
    const payment = await prisma.payment.create({
      data: {
        businessId: purchase.businessId,
        packagePurchaseId: purchase.id,
        customerId: purchase.customerId,
        provider: provider.name as PaymentProvider,
        providerPaymentId: null,
        amount: purchase.pricePaid,
        currency,
        status: PaymentStatus.pending,
        paymentType: PaymentType.package_purchase,
      },
    })
    localPaymentId = payment.id
  }

  const result = await createMpPreferenceForPayment(provider, {
    amount: purchase.pricePaid,
    currency,
    description: `Paquete ${purchase.product.name}`,
    returnUrl: getPackageConfirmationUrl(purchase.business, purchase.id),
    webhookUrl: `${getPaymentAppUrl()}/api/webhooks/mercado-pago`,
    localPaymentId,
    customerEmail: purchase.customer.email,
    metadata: {
      packagePurchaseId: purchase.id,
      businessId: purchase.businessId,
      paymentType: 'package_purchase',
      localPaymentId,
    },
  })

  if (result.redirectUrl) {
    return { redirectUrl: result.redirectUrl }
  }

  // Provider sin redirect (mock/test): confirmar server-side de inmediato.
  await verifyAndConfirmPackagePayment({ purchaseId: purchase.id })
  return { confirmed: true }
}

/**
 * Confirma el pago mock/no-MP de una compra de paquete, delegando la
 * activación (grants + ledger) a `applyApprovedPackagePayment`. Para
 * Mercado Pago corta temprano: la confirmación real llega por webhook.
 */
export async function verifyAndConfirmPackagePayment(input: { purchaseId: string }): Promise<{ success: boolean }> {
  const user = await getCurrentUser()
  if (!user) throw new Error('Debes iniciar sesión.')

  // Es un 'use server' export directamente invocable; rate-limit por consistencia
  // con initiate/create aunque en prod (MP) sea un no-op ownership-gated.
  const limit = await checkRateLimit('verify-package-payment', 20, 60000, { userId: user.id })
  if (!limit.success) throw new Error('Demasiadas solicitudes. Intenta de nuevo en unos minutos.')

  const purchase = await loadOwnedPurchase(input.purchaseId, user.id)

  const payment = await prisma.payment.findFirst({
    where: { packagePurchaseId: purchase.id, paymentType: PaymentType.package_purchase },
    orderBy: { createdAt: 'desc' },
  })
  if (!payment) throw new Error('Pago no encontrado')

  if (payment.provider === PaymentProvider.mercado_pago) {
    return { success: false }
  }

  await prisma.$transaction(async (tx) => {
    await applyApprovedPackagePayment({
      tx,
      packagePurchaseId: purchase.id,
      businessId: purchase.businessId,
      amount: payment.amount,
      currency: payment.currency,
      provider: payment.provider,
      providerPaymentId: payment.providerPaymentId,
      paymentType: payment.paymentType,
      paymentMethod: payment.paymentMethod,
      paymentId: payment.id,
    })
  })

  return { success: true }
}

/** Declaración pública "ya transferí" de una compra de paquete por transferencia. */
export async function declarePackageTransfer(input: { purchaseId: string }): Promise<{ ok: true }> {
  const user = await getCurrentUser()
  if (!user) throw new Error('Debes iniciar sesión.')
  const limit = await checkRateLimit('declare-package-transfer', 20, 60000, { userId: user.id })
  if (!limit.success) throw new Error('Demasiadas solicitudes. Intenta de nuevo en unos minutos.')

  const purchase = await loadOwnedPurchase(input.purchaseId, user.id)
  if (purchase.status !== 'pending') throw new Error('Esta compra ya fue procesada.')
  // SIN check de hold a propósito (fix zombie, spec §5): la plata pudo enviarse
  // aunque el hold venciera y acá no hay cupo en juego. La ventana la cierra el
  // sweep: cuando expira la compra no-declarada, el guard de status de arriba
  // rechaza. Una vez declarada, el sweep la exime y la dueña decide.

  const declaredId = btPkgDeclaredId(purchase.id)
  await prisma.$transaction(async (tx) => {
    // CAS sobre la fila de la compra DENTRO de la misma tx que crea el Payment:
    // toma el lock y re-valida pending, serializando contra el sweep (que también
    // hace updateMany sobre esta fila). Si el sweep ganó y la expiró entre el read
    // de arriba y acá, esto corta antes de crear un Payment huérfano invisible.
    const guard = await tx.packagePurchase.updateMany({
      where: { id: purchase.id, status: 'pending' },
      data: { status: 'pending' },
    })
    if (guard.count === 0) throw new Error('Esta compra ya fue procesada.')
    // Idempotente por @@unique([packagePurchaseId, provider, providerPaymentId]).
    await tx.payment.upsert({
      where: { packagePurchaseId_provider_providerPaymentId: {
        packagePurchaseId: purchase.id, provider: 'manual', providerPaymentId: declaredId,
      } },
      update: {},
      create: {
        businessId: purchase.businessId, packagePurchaseId: purchase.id, customerId: purchase.customerId,
        provider: 'manual', providerPaymentId: declaredId, amount: purchase.pricePaid,
        currency: purchase.business.currency || 'CLP', status: 'pending',
        paymentType: 'package_purchase', paymentMethod: 'Transferencia',
      },
    })
  })

  // Notificar a la dueña (best-effort, no bloquea la declaración de la clienta).
  // Reusa los datos ya cargados por loadOwnedPurchase — sin segunda query.
  await sendMultiNotificationSafely('package transfer declared business', async () =>
    sendPackageTransferDeclaredToBusiness(purchase.businessId, {
      businessName: purchase.business.name, customerName: purchase.customer.name, productName: purchase.product.name,
      amount: purchase.pricePaid, businessCurrency: purchase.business.currency || 'CLP',
    }),
  )

  return { ok: true }
}
