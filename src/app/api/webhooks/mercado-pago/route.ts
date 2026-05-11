import { NextRequest, NextResponse } from 'next/server'
import { store } from '@/lib/data/mock-store'
import { confirmPayment } from '@/server/actions/bookings'
import { createHmac } from 'crypto'

// Mercado Pago webhook signature validation
// Docs: https://www.mercadopago.cl/developers/en/docs/your-integrations/notifications/webhooks
function verifyMercadoPagoSignature(payload: string, signature: string | null, secret: string): boolean {
  if (!signature) return false
  const expected = createHmac('sha256', secret).update(payload).digest('hex')
  return signature === expected
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

    // Verify webhook signature in production
    const mpSecret = process.env.MERCADO_PAGO_WEBHOOK_SECRET
    if (mpSecret) {
      const signature = request.headers.get('x-signature')
      if (!verifyMercadoPagoSignature(rawBody, signature, mpSecret)) {
        return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
      }
    } else {
      console.warn('[Mercado Pago Webhook] No MERCADO_PAGO_WEBHOOK_SECRET configured, skipping signature validation')
    }

    // Extract payment info from payload
    const paymentId = payload.data.id
    const status = payload.type || payload.action

    // Find payment in store
    const payment = store.payments.find((p) => p.providerPaymentId === paymentId)
    if (!payment) {
      return NextResponse.json({ error: 'Payment not found' }, { status: 404 })
    }

    // Process based on status
    if (status === 'payment.created' || status === 'payment.updated') {
      // In production, fetch payment details from Mercado Pago API
      // const mpPayment = await fetchMercadoPagoPayment(paymentId)
      
      // For now, approve if it's a known payment
      if (payment.status === 'pending') {
        // Update payment status
        payment.status = 'approved'
        payment.paidAt = new Date()

        // Confirm booking payment
        await confirmPayment(payment.bookingId, payment.amount)

        return NextResponse.json({ success: true, message: 'Payment approved' })
      }
    }

    return NextResponse.json({ success: true, message: 'Webhook processed' })
  } catch (error) {
    console.error('[Mercado Pago Webhook Error]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function GET(request: NextRequest) {
  // Mercado Pago sometimes sends verification GET requests
  return NextResponse.json({ status: 'ok' })
}
