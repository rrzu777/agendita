import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { applyApprovedPayment } from '@/server/services/finance'
import { createHmac } from 'crypto'
import { sendBookingConfirmedNotification, sendNotificationSafely } from '@/lib/notifications'

// Mercado Pago webhook signature validation
// Docs: https://www.mercadopago.cl/developers/en/docs/your-integrations/notifications/webhooks
function verifyMercadoPagoSignature(payload: string, signature: string | null, secret: string): boolean {
  if (!signature) return false
  const expected = createHmac('sha256', secret).update(payload).digest('hex')
  return signature === expected
}

/**
 * Determina si un pago debe ser marcado como aprobado basado en su provider.
 * Falla cerrado: nunca aprueba sin verificación real del provider.
 */
async function determineApprovalStatus(
  payment: { provider: string; providerPaymentId: string | null; id: string }
): Promise<{ approved: boolean; error?: string }> {
  if (payment.provider === 'mock') {
    if (process.env.NODE_ENV === 'production') {
      return { approved: false, error: 'Mock provider not allowed in production' }
    }
    return { approved: true }
  }

  if (payment.provider === 'mercado_pago') {
    // Not implemented: real verification requires Mercado Pago SDK/API
    return { approved: false, error: 'Mercado Pago webhook verification is not implemented' }
  }

  if (payment.provider === 'webpay') {
    return { approved: false, error: 'Webpay webhook verification is not implemented' }
  }

  return { approved: false, error: `Unsupported payment provider: ${payment.provider}` }
}

export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.text()
    const payload = JSON.parse(rawBody)

    // Log webhook for debugging
    console.log('[Mercado Pago Webhook]', payload)

    // Validate payload structure
    if (!payload || !payload.data || !payload.data.id) {
      return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
    }

    // Verify webhook signature
    const mpSecret = process.env.MERCADO_PAGO_WEBHOOK_SECRET
    if (!mpSecret) {
      // Fail-closed in production: reject unsigned webhooks
      if (process.env.NODE_ENV === 'production') {
        console.error('[Mercado Pago Webhook] MERCADO_PAGO_WEBHOOK_SECRET missing in production')
        return NextResponse.json({ error: 'Webhook secret not configured' }, { status: 500 })
      }
      console.warn('[Mercado Pago Webhook] No MERCADO_PAGO_WEBHOOK_SECRET configured, skipping signature validation (dev only)')
    } else {
      const signature = request.headers.get('x-signature')
      if (!verifyMercadoPagoSignature(rawBody, signature, mpSecret)) {
        return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
      }
    }

    // Extract payment info from payload
    const providerPaymentId = payload.data.id

    // Find payment in real database by providerPaymentId
    const payment = await prisma.payment.findFirst({
      where: { providerPaymentId },
      include: { booking: true },
    })

    if (!payment) {
      return NextResponse.json({ error: 'Payment not found' }, { status: 404 })
    }

    // Validate ownership: payment and booking must belong to the same business
    if (payment.booking && payment.businessId !== payment.booking.businessId) {
      return NextResponse.json({ error: 'Business mismatch' }, { status: 403 })
    }

    // Determine if payment should be approved (fail-closed)
    const { approved, error } = await determineApprovalStatus(payment)
    if (!approved) {
      return NextResponse.json({ error: error || 'Payment not approved' }, { status: 501 })
    }

    // Idempotent application: only update if not already approved
    const result = await prisma.$transaction(async (tx) => {
      return applyApprovedPayment({
        tx,
        bookingId: payment.bookingId,
        businessId: payment.businessId,
        amount: payment.amount,
        currency: payment.currency,
        provider: payment.provider,
        providerPaymentId: payment.providerPaymentId,
        paymentType: payment.paymentType,
        paymentMethod: payment.paymentMethod,
        paymentId: payment.id,
      })
    })

    if (!result || !result.booking) throw new Error('Reserva no encontrada')

    if (result.wasConfirmed) {
      await sendNotificationSafely('booking confirmed', () =>
        sendBookingConfirmedNotification(payment.bookingId, payment.businessId),
      )
    }

    return NextResponse.json({ success: true, message: 'Payment approved', bookingId: result.booking.id })
  } catch (error) {
    console.error('[Mercado Pago Webhook Error]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function GET(request: NextRequest) {
  // Mercado Pago sometimes sends verification GET requests
  return NextResponse.json({ status: 'ok' })
}
