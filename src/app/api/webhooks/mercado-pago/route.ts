import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/db'
import { applyApprovedPayment, applyApprovedPackagePayment, describeUnexpectedPackagePayment } from '@/server/services/finance'
import { firePaymentNotConfirmedNotification } from '@/lib/bookings/notify-payment-not-confirmed'
import {
  sendBookingConfirmedNotification,
  sendNotificationSafely,
  sendMultiNotificationSafely,
  sendPackagePurchasedNotification,
  sendPackageSoldNotificationToBusiness,
  sendPackageDisputedToBusiness,
  sendPackageUnexpectedPaymentToBusiness,
  sendBookingDisputedToBusiness,
  sendBookingUnexpectedPaymentToBusiness,
} from '@/lib/notifications'
import type { EmailResult } from '@/lib/notifications'
import { logger } from '@/lib/logger'
import { getValidBusinessAccessTokenForAccount } from '@/lib/payments/mercado-pago-oauth'
import { releaseRedemptionForBooking } from '@/lib/promotions/release'
import { clawbackLoyaltyForBooking } from '@/lib/loyalty/clawback'
import { reversePackagePurchaseInTx } from '@/lib/packages/reverse'
import { reverseBookingPaymentInTx } from '@/lib/bookings/reverse-payment'
import { formatBookingNumber } from '@/lib/bookings/number'
import { getVocabulary } from '@/lib/vocabulary'
import type { Prisma } from '@prisma/client'
import { verifyMercadoPagoSignature } from '@/lib/payments/mercado-pago-signature'

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

/** Compra de paquete con lo que necesitan los emails a la dueña (negocio, clienta, producto). */
function findPurchaseForBusinessEmail(packagePurchaseId: string) {
  return prisma.packagePurchase.findUnique({
    where: { id: packagePurchaseId },
    include: {
      product: { select: { name: true } },
      customer: { select: { name: true } },
      business: { select: { name: true, currency: true, category: true } },
    },
  })
}

type PurchaseForBusinessEmail = NonNullable<Awaited<ReturnType<typeof findPurchaseForBusinessEmail>>>

/** Carga la compra y manda el email a la dueña, error-aislado. Si la compra ya no
 *  está, se salta en vez de romper el webhook. */
function notifyBusinessAboutPurchase(
  label: string,
  packagePurchaseId: string,
  send: (purchase: PurchaseForBusinessEmail) => Promise<EmailResult[]>,
): Promise<unknown> {
  return sendMultiNotificationSafely(label, async () => {
    const purchase = await findPurchaseForBusinessEmail(packagePurchaseId)
    if (!purchase) {
      return [{ success: false as const, skipped: 'Compra no encontrada' }]
    }
    return send(purchase)
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
  collector_id: number | string | null
  metadata: Record<string, string> | null
}

const MP_PAYMENT_STATUSES = new Set(['approved', 'pending', 'in_process', 'rejected', 'cancelled', 'refunded', 'charged_back'])

function parseMpPayment(value: unknown): MpPayment | null {
  if (!value || typeof value !== 'object') return null
  const v = value as Record<string, unknown>
  if ((typeof v.id !== 'string' && typeof v.id !== 'number') ||
      typeof v.status !== 'string' || !MP_PAYMENT_STATUSES.has(v.status) ||
      typeof v.transaction_amount !== 'number' || !Number.isFinite(v.transaction_amount) ||
      typeof v.currency_id !== 'string' ||
      (typeof v.collector_id !== 'string' && typeof v.collector_id !== 'number')) return null
  const rawMetadata = v.metadata
  const metadata = rawMetadata && typeof rawMetadata === 'object' && !Array.isArray(rawMetadata)
    ? Object.fromEntries(Object.entries(rawMetadata).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
    : null
  return {
    id: String(v.id), status: v.status, transaction_amount: v.transaction_amount,
    currency_id: v.currency_id, collector_id: v.collector_id,
    status_detail: typeof v.status_detail === 'string' ? v.status_detail : null,
    date_approved: typeof v.date_approved === 'string' ? v.date_approved : null,
    date_created: typeof v.date_created === 'string' ? v.date_created : '',
    external_reference: typeof v.external_reference === 'string' ? v.external_reference : null,
    metadata,
  }
}

function sanitaryPaymentPayload(payment: MpPayment): Prisma.InputJsonObject {
  return {
    id: String(payment.id), status: payment.status, statusDetail: payment.status_detail,
    transactionAmount: payment.transaction_amount, currencyId: payment.currency_id,
    dateApproved: payment.date_approved, dateCreated: payment.date_created,
    externalReference: payment.external_reference,
    collectorId: payment.collector_id === null ? null : String(payment.collector_id),
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
      if (!verifyMercadoPagoSignature({
        resourceId: mpPaymentId,
        requestId: reqId,
        signatureHeader,
        secret: mpSecret,
      })) {
        logger.webhook.rejected('mercado_pago', 'Invalid signature', requestId)
        return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
      }
    } else {
      console.warn('[MP Webhook] No MERCADO_PAGO_WEBHOOK_SECRET configured, skipping signature validation (dev only)')
    }

    // `local_payment_id` sólo localiza un candidato. No es autoridad: antes de
    // mutar estado verificamos el pago real con el token OAuth del mismo negocio
    // y exigimos que external_reference, metadata, vendedor, monto y moneda
    // coincidan. Esto evita el fetch inicial con la credencial global de Agendita.
    const localPaymentId = url.searchParams.get('local_payment_id')
    if (!localPaymentId) {
      logger.webhook.rejected('mercado_pago', 'missing local payment locator', requestId)
      return NextResponse.json({ error: 'Missing payment locator' }, { status: 400 })
    }

    const payment = await prisma.payment.findUnique({
      where: { id: localPaymentId },
      include: {
        booking: true,
        packagePurchase: { select: { customerId: true, businessId: true } },
      },
    })

    if (!payment) {
      logger.webhook.rejected('mercado_pago', 'Payment not found', requestId)
      return NextResponse.json({ error: 'Payment not found' }, { status: 404 })
    }

    if (payment.provider !== 'mercado_pago') {
      logger.webhook.rejected('mercado_pago', `Provider mismatch: ${payment.provider}`, requestId)
      return NextResponse.json({ error: 'Payment provider mismatch' }, { status: 400 })
    }

    if (!payment.providerEnvironment) {
      logger.webhook.rejected('mercado_pago', 'Payment has no Mercado Pago environment', requestId)
      return NextResponse.json({ error: 'Payment environment is missing' }, { status: 400 })
    }
    if (payment.booking && payment.businessId !== payment.booking.businessId) {
      logger.webhook.rejected('mercado_pago', 'Business mismatch payment vs booking', requestId)
      return NextResponse.json({ error: 'Business mismatch' }, { status: 403 })
    }
    if (payment.packagePurchase && payment.businessId !== payment.packagePurchase.businessId) {
      logger.webhook.rejected('mercado_pago', 'Business mismatch payment vs package purchase', requestId)
      return NextResponse.json({ error: 'Business mismatch' }, { status: 403 })
    }
    if (Boolean(payment.bookingId) === Boolean(payment.packagePurchaseId)) {
      logger.webhook.rejected('mercado_pago', 'Payment ownership type is ambiguous', requestId)
      return NextResponse.json({ error: 'Payment ownership type is ambiguous' }, { status: 400 })
    }

    const paymentAccount = await prisma.paymentAccount.findFirst({
      where: {
        businessId: payment.businessId,
        provider: 'mercado_pago',
        environment: payment.providerEnvironment,
        status: 'connected',
      },
    })
    if (!paymentAccount?.providerAccountId) {
      logger.webhook.rejected('mercado_pago', 'No connected seller account for payment', requestId)
      return NextResponse.json({ error: 'Business has no connected Mercado Pago account' }, { status: 400 })
    }

    let businessToken: string
    try {
      businessToken = await getValidBusinessAccessTokenForAccount(
        paymentAccount.id, payment.businessId, payment.providerEnvironment,
      )
    } catch {
      logger.webhook.rejected('mercado_pago', 'Failed to resolve valid business token', requestId)
      return NextResponse.json({ error: 'Server configuration error' }, { status: 500 })
    }

    let mpPayment: MpPayment
    try {
      const providerPayload = await mpFetchWithToken<unknown>(`/v1/payments/${mpPaymentId}`, businessToken)
      const parsedPayment = parseMpPayment(providerPayload)
      if (!parsedPayment) throw new Error('Invalid Mercado Pago payment response')
      mpPayment = parsedPayment
    } catch (e) {
      logger.webhook.rejected(
        'mercado_pago',
        `Failed to verify payment with business token: ${e instanceof Error ? e.message : 'Unknown'}`,
        requestId,
      )
      return NextResponse.json({ error: 'Failed to verify payment with business credentials' }, { status: 502 })
    }

    if (String(mpPayment.id) !== mpPaymentId) {
      logger.webhook.rejected('mercado_pago', 'Provider payment id mismatch', requestId)
      return NextResponse.json({ error: 'Provider payment id mismatch' }, { status: 400 })
    }
    if (mpPayment.external_reference !== payment.id) {
      logger.webhook.rejected('mercado_pago', 'external_reference mismatch', requestId)
      return NextResponse.json({ error: 'external_reference mismatch' }, { status: 400 })
    }
    if (String(mpPayment.collector_id ?? '') !== paymentAccount.providerAccountId) {
      logger.webhook.rejected('mercado_pago', 'Seller mismatch', requestId)
      return NextResponse.json({ error: 'Seller mismatch' }, { status: 403 })
    }

    const mpStatus = mpPayment.status
    const safeRawPayload = sanitaryPaymentPayload(mpPayment)

    // Toda transición exige metadata de ownership completa y específica del tipo.
    const metadata = mpPayment.metadata ?? {}

    {
      // Rama paquete (B4b-2): un pago sin bookingId con packagePurchaseId set es
      // una compra de paquete online; su metadata requerida difiere (packagePurchaseId
      // en vez de bookingId).
      const isPackagePayment = !payment.bookingId && !!payment.packagePurchaseId
      const requiredMetadataFields = isPackagePayment
        ? (['localPaymentId', 'packagePurchaseId', 'businessId', 'paymentType'] as const)
        : (['localPaymentId', 'bookingId', 'businessId', 'paymentType'] as const)
      const missingFields = requiredMetadataFields.filter(f => !metadata[f])
      if (missingFields.length > 0) {
        console.error('[MP Webhook] missing required metadata fields for payment', {
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
        if (metadata.bookingId) return NextResponse.json({ error: 'Unexpected bookingId metadata' }, { status: 400 })
        if (metadata.packagePurchaseId !== payment.packagePurchaseId) {
          console.error('[MP Webhook] packagePurchaseId mismatch', {
            metadata: metadata.packagePurchaseId,
            db: payment.packagePurchaseId,
          })
          return NextResponse.json({ error: 'packagePurchaseId mismatch' }, { status: 400 })
        }
      } else {
        if (metadata.packagePurchaseId) return NextResponse.json({ error: 'Unexpected packagePurchaseId metadata' }, { status: 400 })
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
      const purchase = await findPurchaseForBusinessEmail(packagePurchaseId)
      if (purchase && purchase.status === 'active') {
        // 'charged_back' = disputa involuntaria → reversión total (clawback + descubrir
        // reservas) + alarma a la dueña. 'refunded' que llega con la compra AÚN activa
        // (refund directo en MP, o carrera del refund voluntario cuyo tx local no cerró)
        // → semántica voluntary conservadora, sin alarma de contracargo.
        const reverseMode = mpStatus === 'charged_back' ? 'chargeback' : 'voluntary'
        await prisma.$transaction(async (tx) => {
          await tx.payment.update({
            where: { id: payment.id },
            data: { status: 'refunded', providerPaymentId: mpPayment.id, rawPayload: safeRawPayload },
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
              businessName: purchase.business.name, businessCategory: purchase.business.category,
              customerName: purchase.customer.name, productName: purchase.product.name,
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

    // FU-B4b-3: chargeback/refund del pago YA APROBADO de una RESERVA. Igual que
    // la rama de paquete de arriba, hay que actuar ANTES del early-return approved.
    // Política (spec §1-2): la reserva NO cambia de status (la dueña decide); los
    // montos cobrables se restauran vía recalc y paymentStatus queda 'refunded'
    // como marcador. 'charged_back' = disputa → alarma; 'refunded' = devolución
    // voluntaria desde el panel de MP → silencioso.
    // Garantía de reconciliación por eco: si una reversión local falla a mitad,
    // MP re-entrega este evento y el flip CAS lo reintenta idempotente.
    if (
      (mpStatus === 'charged_back' || mpStatus === 'refunded') &&
      payment.bookingId &&
      payment.booking &&
      payment.status === 'approved'
    ) {
      const booking = payment.booking
      const bookingId = payment.bookingId
      const mode = mpStatus === 'charged_back' ? 'chargeback' : 'voluntary'
      const { reversed } = await prisma.$transaction((tx) =>
        reverseBookingPaymentInTx(tx, {
          paymentId: payment.id,
          bookingId,
          businessId: payment.businessId,
          customerId: booking.customerId,
          amount: mpPayment.transaction_amount,
          currency: payment.currency,
          mode,
          now: new Date(),
          flipData: { providerPaymentId: mpPayment.id, rawPayload: safeRawPayload },
        }),
      )
      if (reversed && mode === 'chargeback') {
        // Nombres para la alarma: un fetch fuera de la tx (best-effort como todas
        // las notifs). Los scalars de la reserva ya vienen en payment.booking.
        const bk = await prisma.booking.findUnique({
          where: { id: bookingId },
          select: {
            customer: { select: { name: true } },
            service: { select: { name: true } },
            business: { select: { name: true, currency: true, timezone: true, category: true } },
          },
        })
        if (bk) {
          await sendMultiNotificationSafely('booking disputed business', async () =>
            sendBookingDisputedToBusiness(payment.businessId, {
              businessName: bk.business.name,
              businessCategory: bk.business.category,
              customerName: bk.customer?.name ?? getVocabulary(bk.business.category).Client,
              serviceName: bk.service?.name ?? 'servicio',
              bookingLabel: formatBookingNumber(booking.bookingNumber, bookingId),
              startDateTime: booking.startDateTime,
              businessTimezone: bk.business.timezone || 'America/Santiago',
              amount: mpPayment.transaction_amount,
              businessCurrency: bk.business.currency || 'CLP',
            }),
          )
        }
      }
      if (reversed) {
        revalidatePath('/dashboard/bookings')
        if (booking.customerId) revalidatePath(`/dashboard/customers/${booking.customerId}`)
      }
      return NextResponse.json({
        success: true,
        message: mode === 'chargeback' ? 'Booking chargeback processed' : 'Booking refund processed',
        bookingId,
      })
    }

    // Ya está approved → idempotente, 200 sin side effects
    if (payment.status === 'approved') {
      if (payment.providerPaymentId && payment.providerPaymentId !== mpPayment.id) {
        return NextResponse.json({ error: 'ProviderPaymentId conflict' }, { status: 409 })
      }
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
              rawPayload: safeRawPayload,
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
            rawPayload: safeRawPayload,
            paymentId: payment.id,
            // El cobro YA ocurrió y del otro lado no hay nadie a quien decirle
            // "no": si esto lanzara (reserva vencida por el cron, cancelada, hold
            // vencido), el webhook devolvería 500, MP reintentaría el mismo evento
            // para siempre y la plata no quedaría asentada en ningún lado. Se
            // registra igual; `unconfirmedReason` dice por qué no confirmó y el
            // aviso de abajo se lo cuenta a la dueña.
            recordEvenIfNotPayable: true,
          })
          // 15s y no el default de 5s: al confirmar, esta tx ahora toma el advisory
          // lock por negocio+día para re-chequear el cupo, así que puede quedar
          // esperando a una creación de reserva concurrente. Con 5s el timeout daría
          // 500 → MP reintenta y el cobro no queda asentado, justo lo que este camino
          // trata de evitar. Mismo presupuesto que la tx de createBooking.
        }, { timeout: 15_000 })

        if (!result || !result.booking) {
          throw new Error('Reserva no encontrada')
        }

        if (result.wasConfirmed) {
          await sendNotificationSafely('booking confirmed', () =>
            sendBookingConfirmedNotification(bookingId, payment.businessId),
          )
        }

        // Entró plata nueva sobre una reserva que ya estaba saldada (la clienta pagó
        // por otra vía y MP aprobó tarde, o dos intentos que terminaron aprobados los
        // dos). El servicio ya lo asentó como `overpayment`; acá sólo avisamos para
        // que la dueña decida el reembolso. La clienta NO recibe nada: para ella su
        // reserva no cambió.
        if (result.wasUnexpected) {
          const bk = await prisma.booking.findUnique({
            where: { id: bookingId },
            select: {
              bookingNumber: true,
              customer: { select: { name: true } },
              service: { select: { name: true } },
              business: { select: { name: true, currency: true } },
            },
          })
          if (bk) {
            await sendMultiNotificationSafely('booking unexpected payment business', async () =>
              sendBookingUnexpectedPaymentToBusiness(payment.businessId, {
                businessName: bk.business.name,
                customerName: bk.customer?.name ?? 'Clienta',
                serviceName: bk.service?.name ?? 'servicio',
                bookingLabel: formatBookingNumber(bk.bookingNumber, bookingId),
                amount: payment.amount,
                businessCurrency: bk.business.currency || 'CLP',
              }),
            )
          }
        }

        // La plata entró y quedó asentada, pero la reserva NO se confirmó: el
        // horario ya no estaba libre, o la reserva ya no estaba vigente (venció y
        // el cron la barrió, la dueña la canceló). Este mail es el único canal —
        // pasa en un webhook, sin nadie mirando la pantalla — y decide la dueña:
        // reacomodar en otra hora o reembolsar. La clienta no recibe nada todavía,
        // justamente porque su hora está en manos de esa decisión.
        if (result.unconfirmedReason) {
          await firePaymentNotConfirmedNotification({
            bookingId,
            businessId: payment.businessId,
            reason: result.unconfirmedReason,
            amount: payment.amount,
          })
        }

        logger.payment.approved(payment.id, bookingId, payment.businessId)

        // 200 y no error: el cobro ya quedó registrado, así que un redelivery no
        // arregla nada — devolver 500 sólo haría que Mercado Pago reintentara para
        // siempre el mismo evento ya procesado.
        return NextResponse.json({
          success: true,
          message: result.unconfirmedReason
            ? `Payment approved, booking left unconfirmed: ${result.unconfirmedReason.kind}`
            : 'Payment approved',
          bookingId: result.booking.id,
        })
      }

      // Rama paquete (B4b-2): pago sin bookingId asociado a una compra de paquete.
      const packagePurchaseId = payment.packagePurchaseId
      if (!packagePurchaseId) {
        return NextResponse.json({ error: 'Pago no asociado a una reserva ni a un paquete' }, { status: 400 })
      }

      const { outcome } = await prisma.$transaction(async (tx) => {
        // Actualizar providerPaymentId y rawPayload
        await tx.payment.update({
          where: { id: payment.id },
          data: {
            providerPaymentId: mpPayment.id,
            rawPayload: safeRawPayload,
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
          rawPayload: safeRawPayload,
          paymentId: payment.id,
        })
      })

      // Notificar SOLO en la primera activación: MP redeliveria el webhook
      // (at-least-once) y sin este gate cada reintento reenviaría los dos emails.
      // Espejo del `wasConfirmed` de la rama de reserva.
      if (outcome === 'activated') {
        // Ambos envíos son independientes y ya vienen error-aislados por sus
        // wrappers *Safely; corren en paralelo para no encadenar latencia de email.
        await Promise.all([
          sendNotificationSafely('package purchased customer', () =>
            sendPackagePurchasedNotification(packagePurchaseId, payment.businessId),
          ),
          notifyBusinessAboutPurchase('package sold business', packagePurchaseId, (purchase) =>
            sendPackageSoldNotificationToBusiness(payment.businessId, {
              businessName: purchase.business.name,
              businessCategory: purchase.business.category,
              customerName: purchase.customer.name,
              productName: purchase.product.name,
              totalSessions: purchase.quantity + purchase.bonusQuantity,
              pricePaid: purchase.pricePaid,
              businessCurrency: purchase.business.currency || 'CLP',
            }),
          ),
        ])
      }

      // Entró plata nueva sobre una compra que no la esperaba: ya activa (la clienta
      // pagó por transferencia, la dueña confirmó y MP aprobó tarde), ya reembolsada
      // o rechazada por la dueña. El servicio ya lo asentó en el ledger; acá sólo
      // avisamos para que la dueña decida el reembolso. La clienta NO recibe nada:
      // para ella no hubo una compra nueva. El `status` es el de antes de la tx —
      // esta rama justamente no lo toca.
      if (outcome === 'unexpected') {
        await notifyBusinessAboutPurchase('package unexpected payment business', packagePurchaseId, (purchase) =>
          sendPackageUnexpectedPaymentToBusiness(payment.businessId, {
            businessName: purchase.business.name,
            businessCategory: purchase.business.category,
            customerName: purchase.customer.name,
            productName: purchase.product.name,
            amount: payment.amount,
            businessCurrency: purchase.business.currency || 'CLP',
            situation: describeUnexpectedPackagePayment(purchase.status),
          }),
        )
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
            rawPayload: safeRawPayload,
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
      // Degradar es SOLO para pagos que nunca se aprobaron (pending, el único
      // estado no-terminal local: in_process de MP se guarda como pending).
      // Un redelivery de refunded/charged_back sobre un Payment que la rama de
      // reversión ya dejó 'refunded' caería acá y re-liberaría la redención que
      // esa rama deliberadamente conserva (spec §2, corrupción de promo) — por
      // eso el guard es por 'pending', no por 'approved'.
      const currentPayment = await prisma.payment.findUnique({
        where: { id: payment.id },
      })
      if (currentPayment?.status !== 'pending') {
        return NextResponse.json({
          success: true,
          message: 'Payment not pending, not downgrading',
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
            rawPayload: safeRawPayload,
          },
        })
        if (finalStatus === 'refunded' && payment.bookingId) {
          await releaseRedemptionForBooking(tx, payment.bookingId, 'refunded')
          await clawbackLoyaltyForBooking(tx, {
            bookingId: payment.bookingId,
            businessId: payment.businessId,
            now: new Date(),
          })
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
