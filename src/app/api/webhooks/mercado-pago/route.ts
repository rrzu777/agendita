import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { applyApprovedPayment } from '@/server/services/finance'
import { createHmac, timingSafeEqual } from 'crypto'
import { sendBookingConfirmedNotification, sendNotificationSafely } from '@/lib/notifications'
import type { Prisma } from '@prisma/client'

function mpFetch<T>(path: string, accessToken: string): Promise<T> {
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

function getAccessToken(): string {
  const token = process.env.MERCADO_PAGO_ACCESS_TOKEN
  if (!token) {
    throw new Error('MERCADO_PAGO_ACCESS_TOKEN no está configurado')
  }
  return token
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
    const bodyId = (payload as any)?.data?.id || (payload as any)?.id || null

    if (queryId && bodyId && queryId !== bodyId) {
      console.error('[MP Webhook] data.id mismatch between query and body', { queryId, bodyId })
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

    if (!mpPaymentId) {
      return NextResponse.json({ error: 'Missing payment id' }, { status: 400 })
    }

    // Validar firma
    const mpSecret = process.env.MERCADO_PAGO_WEBHOOK_SECRET
    if (process.env.NODE_ENV === 'production' && !mpSecret) {
      console.error('[MP Webhook] MERCADO_PAGO_WEBHOOK_SECRET missing in production')
      return NextResponse.json({ error: 'Webhook secret not configured' }, { status: 500 })
    }

    if (mpSecret) {
      const signatureHeader = request.headers.get('x-signature')
      const requestId = request.headers.get('x-request-id')
      if (!verifyMercadoPagoSignature(mpPaymentId, requestId, signatureHeader, mpSecret)) {
        return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
      }
    } else {
      console.warn('[MP Webhook] No MERCADO_PAGO_WEBHOOK_SECRET configured, skipping signature validation (dev only)')
    }

    // Consultar pago real a Mercado Pago (no confiar en el payload)
    const accessToken = getAccessToken()
    const mpPayment = await mpFetch<MpPayment>(
      `/v1/payments/${mpPaymentId}`,
      accessToken,
    )

    // Validar external_reference / localPaymentId
    const localPaymentId = mpPayment.external_reference
    if (!localPaymentId) {
      console.error('[MP Webhook] missing external_reference for MP payment', mpPaymentId)
      return NextResponse.json({ error: 'Missing external_reference' }, { status: 400 })
    }

    const payment = await prisma.payment.findUnique({
      where: { id: localPaymentId },
      include: { booking: true },
    })

    if (!payment) {
      console.error('[MP Webhook] Payment not found by external_reference', localPaymentId)
      return NextResponse.json({ error: 'Payment not found' }, { status: 404 })
    }

    if (payment.provider !== 'mercado_pago') {
      console.error('[MP Webhook] Payment provider mismatch', localPaymentId, payment.provider)
      return NextResponse.json({ error: 'Payment provider mismatch' }, { status: 400 })
    }

    // Validar metadata contra DB.
    // Para pagos approved, la metadata con bookingId/businessId/paymentType/localPaymentId
    // es requerida para evitar confirmación fraudulenta.
    const metadata = mpPayment.metadata ?? {}
    const mpStatus = mpPayment.status

    if (mpStatus === 'approved') {
      const requiredMetadataFields = ['localPaymentId', 'bookingId', 'businessId', 'paymentType'] as const
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
      if (metadata.bookingId !== payment.bookingId) {
        console.error('[MP Webhook] bookingId mismatch', {
          metadata: metadata.bookingId,
          db: payment.bookingId,
        })
        return NextResponse.json({ error: 'bookingId mismatch' }, { status: 400 })
      }
      if (metadata.businessId !== payment.businessId) {
        console.error('[MP Webhook] businessId mismatch', {
          metadata: metadata.businessId,
          db: payment.businessId,
        })
        return NextResponse.json({ error: 'businessId mismatch' }, { status: 400 })
      }
      if (metadata.paymentType !== payment.paymentType) {
        console.error('[MP Webhook] paymentType mismatch', {
          metadata: metadata.paymentType,
          db: payment.paymentType,
        })
        return NextResponse.json({ error: 'paymentType mismatch' }, { status: 400 })
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
          bookingId: payment.bookingId,
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
          sendBookingConfirmedNotification(payment.bookingId, payment.businessId),
        )
      }

      return NextResponse.json({
        success: true,
        message: 'Payment approved',
        bookingId: result.booking.id,
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

      await prisma.payment.update({
        where: { id: payment.id },
        data: {
          status: finalStatus,
          providerPaymentId: mpPayment.id,
          rawPayload: mpPayment as unknown as Prisma.InputJsonValue,
        },
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
    console.error('[MP Webhook Error]', error instanceof Error ? error.message : error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function GET() {
  return NextResponse.json({ status: 'ok' })
}
