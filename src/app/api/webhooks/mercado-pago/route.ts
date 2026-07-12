import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/db'
import { applyApprovedPayment, applyApprovedPackagePayment } from '@/server/services/finance'
import { createHmac, timingSafeEqual } from 'crypto'
import {
  sendBookingConfirmedNotification,
  sendNotificationSafely,
  sendMultiNotificationSafely,
  sendPackagePurchasedNotification,
  sendPackageSoldNotificationToBusiness,
  sendPackageDisputedToBusiness,
} from '@/lib/notifications'
import { logger } from '@/lib/logger'
import { decryptSecret } from '@/lib/payments/encryption'
import { releaseRedemptionForBooking } from '@/lib/promotions/release'
import { reverseVisitPoints } from '@/lib/loyalty/credit'
import { reverseAutoRewardsForBooking } from '@/lib/loyalty/automatic'
import { reversePackagePurchaseInTx } from '@/lib/packages/reverse'
import type { Prisma } from '@prisma/client'

function mpFetchWithToken<T>(path: string, accessToken: string): Promise<T> {
  return fetch(`https://api.mercadopago.com${path}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
  }).then(async (res) => {
    if (!res.ok) {
      const body = await res.text()
      throw new Error(`Mercado Pago API error ${res.status} for ${path}: ${body}`)
    }
    return res.json() as Promise<T>
  })
}

interface MpPayment {
  id: string
  status: string
  status_detail: string | null
  transaction_amount: number
  currency_id: string
  date_approved: string | null
  date_created: string
  external_reference: string | null
  metadata: Record<string, string> | null
}

/**
 * Replay protection: reject signatures whose timestamp is outside the allowed
 * window. OPT-IN — only enforced when MERCADO_PAGO_WEBHOOK_TOLERANCE_SECONDS is
 * set, so we never risk rejecting a legitimate (possibly delayed/retried) MP
 * webhook unless the operator deliberately opts into a tolerance. Idempotency
 * already prevents double money-movement; this is defense-in-depth.
 */
function isTimestampFresh(ts: string): boolean {
  const toleranceRaw = process.env.MERCADO_PAGO_WEBHOOK_TOLERANCE_SECONDS
  if (!toleranceRaw) return true
  const tolerance = Number(toleranceRaw)
  if (!Number.isFinite(tolerance) || tolerance <= 0) return true

  const tsNum = Number(ts)
  if (!Number.isFinite(tsNum)) return false
  // MP sends ts in seconds; tolerate millisecond timestamps just in case.
  const tsSeconds = tsNum > 1e12 ? Math.floor(tsNum / 1000) : tsNum
  const nowSeconds = Math.floor(Date.now() / 1000)
  return Math.abs(nowSeconds - tsSeconds) <= tolerance
}

// Mercado Pago webhook signature validation
// Format: x-signature = "ts={timestamp},v1={hmac_sha256_hex}"
// HMAC input: "id:{data.id};request-id:{x-request-id};ts:{ts};"
function verifyMercadoPagoSignature(
  mpPaymentId: string | undefined,
  requestId: string | null,
  signatureHeader: string | null,
  secret: string,
): boolean {
  if (!mpPaymentId || !signatureHeader) return false

  const parts = signatureHeader.split(',')
  let ts = ''
  let v1 = ''

  for (const part of parts) {
    const [key, ...valueParts] = part.split('=')
    const value = valueParts.join('=')
    if (key.trim() === 'ts') ts = value.trim()
    if (key.trim() === 'v1') v1 = value.trim()
  }

  if (!ts || !v1) return false
  if (!isTimestampFresh(ts)) return false

  const manifest = `id:${mpPaymentId};request-id:${requestId ?? ''};ts:${ts};`
  const expected = createHmac('sha256', secret).update(manifest).digest('hex')

  try {
    return timingSafeEqual(Buffer.from(expected), Buffer.from(v1))
  } catch {
    return false
  }
}

export async function POST(request: NextRequest) {
  let mpPaymentId: string | undefined

  try {
    const rawBody = await request.text()
    let payload: Record<string, unknown> = {}

    if (rawBody) {
      try {
        payload = JSON.parse(rawBody)
      } catch {
        // Body might not be JSON (query params case)
      }
    }

    // Mercado Pago puede enviar data.id como query param o en el body JSON.
    // La firma usa query params cuando están presentes. Si ambos existen y difieren,
    // rechazamos por inconsistencia (más seguro que adivinar cuál usar).
    const url = new URL(request.url)
    const queryId = url.searchParams.get('data.id') || url.searchParams.get('id') || null
    const bodyData = (payload as Record<string, unknown> | null)
    const rawBodyId = (bodyData?.data as Record<string, unknown> | undefined)?.id ?? bodyData?.id ?? null
    const bodyId = typeof rawBodyId === 'string' || typeof rawBodyId === 'number'
      ? String(rawBodyId)
      : null

    if (queryId && bodyId && queryId !== bodyId) {
      logger.webhook.rejected('mercado_pago', 'data.id mismatch between query and body')
      return NextResponse.json(
        { error: 'data.id mismatch between query params and body' },
        { status: 400 },
      )
    }

    // Priorizar query params: Mercado Pago usa data.id de query params en el
    // manifiesto de firma (id:{data.id};request-id:{x-request-id};ts:{ts};),
    // por lo que el query param es la fuente canónica para la firma.
    const effectiveId = queryId || bodyId
    mpPaymentId = effectiveId || undefined
    const requestId = request.headers.get('x-request-id') ?? undefined

    logger.webhook.received('mercado_pago', requestId)

    if (!mpPaymentId) {
      logger.webhook.rejected('mercado_pago', 'Missing payment id', requestId)
      return NextResponse.json({ error: 'Missing payment id' }, { status: 400 })
    }

    // Validar firma
    const mpSecret = process.env.MERCADO_PAGO_WEBHOOK_SECRET
    if (process.env.NODE_ENV === 'production' && !mpSecret) {
      logger.webhook.rejected('mercado_pago', 'MERCADO_PAGO_WEBHOOK_SECRET missing in production', requestId)
      return NextResponse.json({ error: 'Webhook secret not configured' }, { status: 500 })
    }

    if (mpSecret) {
      const signatureHeader = request.headers.get('x-signature')
      const reqId = request.headers.get('x-request-id')
      if (!verifyMercadoPagoSignature(mpPaymentId, reqId, signatureHeader, mpSecret)) {
        logger.webhook.rejected('mercado_pago', 'Invalid signature', requestId)
        return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
      }
    } else {
      console.warn('[MP Webhook] No MERCADO_PAGO_WEBHOOK_SECRET configured, skipping signature validation (dev only)')
    }

    // Consultar pago real a Mercado Pago.
    // Paso 1: Usar token global (app-level) solo para la búsqueda inicial del
    // external_reference. Esto es necesario porque aún no sabemos a qué negocio
    // pertenece el pago. El token global NUNCA se usa para aplicar pagos.
    const globalToken = process.env.MERCADO_PAGO_ACCESS_TOKEN
    if (!globalToken) {
      logger.webhook.rejected('mercado_pago', 'MERCADO_PAGO_ACCESS_TOKEN missing', requestId)
      return NextResponse.json({ error: 'Server configuration error' }, { status: 500 })
    }

    const mpPayment = await mpFetchWithToken<MpPayment>(
      `/v1/payments/${mpPaymentId}`,
      globalToken,
    )

    // Validar external_reference / localPaymentId
    const localPaymentId = mpPayment.external_reference
    if (!localPaymentId) {
      logger.webhook.rejected('mercado_pago', 'missing external_reference', requestId)
      return NextResponse.json({ error: 'Missing external_reference' }, { status: 400 })
    }

    const payment = await prisma.payment.findUnique({
      where: { id: localPaymentId },
      include: { booking: true, packagePurchase: { select: { customerId: true } } },
    })

    if (!payment) {
      logger.webhook.rejected('mercado_pago', 'Payment not found', requestId)
      return NextResponse.json({ error: 'Payment not found' }, { status: 404 })
    }

    if (payment.provider !== 'mercado_pago') {
      logger.webhook.rejected('mercado_pago', `Provider mismatch: ${payment.provider}`, requestId)
      return NextResponse.json({ error: 'Payment provider mismatch' }, { status: 400 })
    }

    // Paso 2: Para pagos approved, REQUERIR verificación con token del negocio.
    // El token global se usó solo para el lookup inicial del external_reference.
    // NUNCA aplicar un pago approved sin re-verificar con el token del negocio.
    const mpStatus = mpPayment.status

    if (mpStatus === 'approved') {
      const paymentAccount = await prisma.paymentAccount.findFirst({
        where: {
          businessId: payment.businessId,
          provider: 'mercado_pago',
          status: 'connected',
        },
      })

      if (!paymentAccount) {
        logger.webhook.rejected('mercado_pago', 'No connected PaymentAccount for approved payment', requestId)
        return NextResponse.json({
          error: 'Business has no connected Mercado Pago account',
        }, { status: 400 })
      }

      let businessToken: string
      try {
        businessToken = decryptSecret(paymentAccount.accessTokenEncrypted)
      } catch {
        logger.webhook.rejected('mercado_pago', 'Failed to decrypt business token for approved payment', requestId)
        return NextResponse.json({ error: 'Server configuration error' }, { status: 500 })
      }

      try {
        const verifiedPayment = await mpFetchWithToken<MpPayment>(
          `/v1/payments/${mpPaymentId}`,
          businessToken,
        )
        Object.assign(mpPayment, verifiedPayment)
      } catch (e) {
        logger.webhook.rejected('mercado_pago',
          `Failed to re-verify approved payment with business token: ${e instanceof Error ? e.message : 'Unknown'}`,
          requestId,
        )
        return NextResponse.json({
          error: 'Failed to verify payment with business credentials',
        }, { status: 502 })
      }
    }

    // Validar metadata contra DB.
    // Para pagos approved, la metadata con bookingId/businessId/paymentType/localPaymentId
    // es requerida para evitar confirmación fraudulenta.
    const metadata = mpPayment.metadata ?? {}

    if (mpStatus === 'approved') {
      // Rama paquete (B4b-2): un pago sin bookingId con packagePurchaseId set es
      // una compra de paquete online; su metadata requerida difiere (packagePurchaseId
      // en vez de bookingId).
      const isPackagePayment = !payment.bookingId && !!payment.packagePurchaseId
      const requiredMetadataFields = isPackagePayment
        ? (['localPaymentId', 'packagePurchaseId', 'businessId', 'paymentType'] as const)
        : (['localPaymentId', 'bookingId', 'businessId', 'paymentType'] as const)
      const missingFields = requiredMetadataFields.filter(f => !metadata[f])
      if (missingFields.length > 0) {
        console.error('[MP Webhook] missing required metadata fields for approved payment', {
          mpPaymentId,
          missingFields,
        })
        return NextResponse.json(
          { error: `Missing required metadata: ${missingFields.join(', ')}` },
          { status: 400 },
        )
      }

      if (metadata.localPaymentId !== payment.id) {
        console.error('[MP Webhook] localPaymentId mismatch', {
          metadata: metadata.localPaymentId,
          db: payment.id,
        })
        return NextResponse.json({ error: 'localPaymentId mismatch' }, { status: 400 })
      }

      // Solo el id de referencia difiere por tipo; el resto de checks son comunes.
      if (isPackagePayment) {
        if (metadata.packagePurchaseId !== payment.packagePurchaseId) {
          console.error('[MP Webhook] packagePurchaseId mismatch', {
            metadata: metadata.packagePurchaseId,
            db: payment.packagePurchaseId,
          })
          return NextResponse.json({ error: 'packagePurchaseId mismatch' }, { status: 400 })
        }
      } else {
        if (metadata.bookingId !== payment.bookingId) {
          console.error('[MP Webhook] bookingId mismatch', {
            metadata: metadata.bookingId,
            db: payment.bookingId,
          })
          return NextResponse.json({ error: 'bookingId mismatch' }, { status: 400 })
        }
      }

      if (metadata.paymentType !== payment.paymentType) {
        console.error('[MP Webhook] paymentType mismatch', {
          metadata: metadata.paymentType,
          db: payment.paymentType,
        })
        return NextResponse.json({ error: 'paymentType mismatch' }, { status: 400 })
      }

      if (metadata.businessId !== payment.businessId) {
        console.error('[MP Webhook] businessId mismatch', {
          metadata: metadata.businessId,
          db: payment.businessId,
        })
        return NextResponse.json({ error: 'businessId mismatch' }, { status: 400 })
      }
    }

    // Validar amount
    if (mpPayment.transaction_amount !== payment.amount) {
      console.error('[MP Webhook] amount mismatch', {
        mp: mpPayment.transaction_amount,
        db: payment.amount,
      })
      return NextResponse.json({ error: 'Amount mismatch' }, { status: 400 })
    }

    // Validar currency
    if (mpPayment.currency_id !== payment.currency) {
      console.error('[MP Webhook] currency mismatch', {
        mp: mpPayment.currency_id,
        db: payment.currency,
      })
      return NextResponse.json({ error: 'Currency mismatch' }, { status: 400 })
    }

    // Validar ownership: payment y booking mismo business
    if (payment.booking && payment.businessId !== payment.booking.businessId) {
      console.error('[MP Webhook] Business mismatch payment vs booking')
      return NextResponse.json({ error: 'Business mismatch' }, { status: 403 })
    }

    // B4b-3: chargeback/refund INVOLUNTARIO de un paquete YA ACTIVO. El Payment está
    // approved, así que hay que actuar ANTES del early-return de abajo. Exclusivo de
    // paquetes activos: reservas y refunds voluntarios (purchase ya 'refunded') no entran.
    if (
      (mpStatus === 'charged_back' || mpStatus === 'refunded') &&
      payment.packagePurchaseId &&
      !payment.bookingId
    ) {
      const packagePurchaseId = payment.packagePurchaseId
      // Un solo fetch con includes: sirve al guard de status y a la notif de abajo.
      const purchase = await prisma.packagePurchase.findUnique({
        where: { id: packagePurchaseId },
        include: {
          product: { select: { name: true } },
          customer: { select: { name: true } },
          business: { select: { name: true, currency: true } },
        },
      })
      if (purchase && purchase.status === 'active') {
        // 'charged_back' = disputa involuntaria → reversión total (clawback + descubrir
        // reservas) + alarma a la dueña. 'refunded' que llega con la compra AÚN activa
        // (refund directo en MP, o carrera del refund voluntario cuyo tx local no cerró)
        // → semántica voluntary conservadora, sin alarma de contracargo.
        const reverseMode = mpStatus === 'charged_back' ? 'chargeback' : 'voluntary'
        await prisma.$transaction(async (tx) => {
          await tx.payment.update({
            where: { id: payment.id },
            data: { status: 'refunded', providerPaymentId: mpPayment.id, rawPayload: mpPayment as unknown as Prisma.InputJsonValue },
          })
          await reversePackagePurchaseInTx(tx, purchase, {
            mode: reverseMode,
            amount: mpPayment.transaction_amount,
            currency: payment.currency,
            paymentId: payment.id,
            now: new Date(),
          })
        })
        if (reverseMode === 'chargeback') {
          await sendMultiNotificationSafely('package disputed business', async () =>
            sendPackageDisputedToBusiness(payment.businessId, {
              businessName: purchase.business.name, customerName: purchase.customer.name, productName: purchase.product.name,
              amount: mpPayment.transaction_amount, businessCurrency: purchase.business.currency || 'CLP',
            }),
          )
        }
        revalidatePath(`/dashboard/customers/${purchase.customerId}`)
        revalidatePath('/dashboard/paquetes')
        return NextResponse.json({ success: true, message: `Package ${reverseMode} processed`, packagePurchaseId })
      }
      // purchase ya no está active (eco del refund voluntario / redelivery) → cae al 200 idempotente.
    }

    // Ya está approved → idempotente, 200 sin side effects
    if (payment.status === 'approved') {
      return NextResponse.json({
        success: true,
        message: 'Payment already approved',
        bookingId: payment.bookingId,
      })
    }

    // Evitar que un providerPaymentId se asocie a otro Payment
    if (payment.providerPaymentId && payment.providerPaymentId !== mpPayment.id) {
      console.error('[MP Webhook] providerPaymentId already set to different value', {
        existing: payment.providerPaymentId,
        incoming: mpPayment.id,
      })
      return NextResponse.json({ error: 'ProviderPaymentId conflict' }, { status: 409 })
    }

    if (mpStatus === 'approved') {
      if (payment.bookingId) {
        const bookingId = payment.bookingId
        // Pago aprobado: actualizar y confirmar booking
        const result = await prisma.$transaction(async (tx) => {
          // Actualizar providerPaymentId y rawPayload
          await tx.payment.update({
            where: { id: payment.id },
            data: {
              providerPaymentId: mpPayment.id,
              rawPayload: mpPayment as unknown as Prisma.InputJsonValue,
            },
          })

          return applyApprovedPayment({
            tx,
            bookingId,
            businessId: payment.businessId,
            amount: payment.amount,
            currency: payment.currency,
            provider: 'mercado_pago',
            providerPaymentId: mpPayment.id,
            paymentType: payment.paymentType,
            paymentMethod: payment.paymentMethod,
            rawPayload: mpPayment as unknown as Prisma.InputJsonValue,
            paymentId: payment.id,
          })
        })

        if (!result || !result.booking) {
          throw new Error('Reserva no encontrada')
        }

        if (result.wasConfirmed) {
          await sendNotificationSafely('booking confirmed', () =>
            sendBookingConfirmedNotification(bookingId, payment.businessId),
          )
        }

        logger.payment.approved(payment.id, bookingId, payment.businessId)

        return NextResponse.json({
          success: true,
          message: 'Payment approved',
          bookingId: result.booking.id,
        })
      }

      // Rama paquete (B4b-2): pago sin bookingId asociado a una compra de paquete.
      const packagePurchaseId = payment.packagePurchaseId
      if (!packagePurchaseId) {
        return NextResponse.json({ error: 'Pago no asociado a una reserva ni a un paquete' }, { status: 400 })
      }

      const { wasActivated } = await prisma.$transaction(async (tx) => {
        // Actualizar providerPaymentId y rawPayload
        await tx.payment.update({
          where: { id: payment.id },
          data: {
            providerPaymentId: mpPayment.id,
            rawPayload: mpPayment as unknown as Prisma.InputJsonValue,
          },
        })

        return applyApprovedPackagePayment({
          tx,
          packagePurchaseId,
          businessId: payment.businessId,
          amount: payment.amount,
          currency: payment.currency,
          provider: 'mercado_pago',
          providerPaymentId: mpPayment.id,
          paymentType: payment.paymentType,
          paymentMethod: payment.paymentMethod,
          rawPayload: mpPayment as unknown as Prisma.InputJsonValue,
          paymentId: payment.id,
        })
      })

      // Notificar SOLO en la primera activación: MP redeliveria el webhook
      // (at-least-once) y sin este gate cada reintento reenviaría los dos emails.
      // Espejo del `wasConfirmed` de la rama de reserva.
      if (wasActivated) {
        // Ambos envíos son independientes y ya vienen error-aislados por sus
        // wrappers *Safely; corren en paralelo para no encadenar latencia de email.
        await Promise.all([
          sendNotificationSafely('package purchased customer', () =>
            sendPackagePurchasedNotification(packagePurchaseId, payment.businessId),
          ),
          sendMultiNotificationSafely('package sold business', async () => {
            const purchase = await prisma.packagePurchase.findUnique({
              where: { id: packagePurchaseId },
              include: {
                product: { select: { name: true } },
                customer: { select: { name: true } },
                business: { select: { name: true, currency: true } },
              },
            })
            if (!purchase) {
              return [{ success: false as const, skipped: 'Compra no encontrada' }]
            }
            return sendPackageSoldNotificationToBusiness(payment.businessId, {
              businessName: purchase.business.name,
              customerName: purchase.customer.name,
              productName: purchase.product.name,
              totalSessions: purchase.quantity + purchase.bonusQuantity,
              pricePaid: purchase.pricePaid,
              businessCurrency: purchase.business.currency || 'CLP',
            })
          }),
        ])
      }

      const customerId = payment.packagePurchase?.customerId
      if (customerId) {
        revalidatePath(`/dashboard/customers/${customerId}`)
      }
      revalidatePath('/dashboard/paquetes')
      revalidatePath('/dashboard/payments')

      logger.payment.approved(payment.id, packagePurchaseId, payment.businessId)

      return NextResponse.json({
        success: true,
        message: 'Package payment approved',
        packagePurchaseId,
      })
    }

    if (mpStatus === 'pending' || mpStatus === 'in_process') {
      // Mantener pending, guardar rawPayload con el estado actualizado
      if (payment.providerPaymentId !== mpPayment.id) {
        await prisma.payment.update({
          where: { id: payment.id },
          data: {
            providerPaymentId: mpPayment.id,
            rawPayload: mpPayment as unknown as Prisma.InputJsonValue,
          },
        })
      }

      return NextResponse.json({
        success: true,
        message: `Payment status: ${mpStatus}`,
      })
    }

    if (
      mpStatus === 'rejected' ||
      mpStatus === 'cancelled' ||
      mpStatus === 'refunded' ||
      mpStatus === 'charged_back'
    ) {
      // No degradar un Payment ya approved
      // (validado arriba, pero por seguridad repetimos el check)
      const currentPayment = await prisma.payment.findUnique({
        where: { id: payment.id },
      })
      if (currentPayment?.status === 'approved') {
        return NextResponse.json({
          success: true,
          message: 'Payment already approved, not downgrading',
        })
      }

      const finalStatus =
        mpStatus === 'cancelled'
          ? 'cancelled'
          : mpStatus === 'refunded' || mpStatus === 'charged_back'
            ? 'refunded'
            : 'rejected'

      await prisma.$transaction(async (tx) => {
        await tx.payment.update({
          where: { id: payment.id },
          data: {
            status: finalStatus,
            providerPaymentId: mpPayment.id,
            rawPayload: mpPayment as unknown as Prisma.InputJsonValue,
          },
        })
        if (finalStatus === 'refunded' && payment.bookingId) {
          await releaseRedemptionForBooking(tx, payment.bookingId, 'refunded')
          await reverseVisitPoints(tx, payment.bookingId)
          const cfg = await tx.loyaltyConfig.findUnique({
            where: { businessId: payment.businessId },
            select: { clawbackAutoRewardOnRefund: true },
          })
          if (cfg?.clawbackAutoRewardOnRefund) {
            await reverseAutoRewardsForBooking(tx, payment.bookingId, new Date(), payment.businessId)
          }
        }
        // Paquete: B4b-2 solo degrada el Payment (arriba). No se revierten grants
        // (política de reversión de paquete activo = B4b-3). El refund real por MP
        // también es B4b-3; acá solo queda el registro degradado.
      })

      return NextResponse.json({
        success: true,
        message: `Payment ${finalStatus}`,
      })
    }

    // Estado desconocido
    console.warn('[MP Webhook] Unknown MP payment status', mpStatus)
    return NextResponse.json(
      { error: `Unknown status: ${mpStatus}` },
      { status: 400 },
    )
  } catch (error) {
    logger.error('webhook.error', error instanceof Error ? error.message : String(error))
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function GET() {
  return NextResponse.json({ status: 'ok' })
}
