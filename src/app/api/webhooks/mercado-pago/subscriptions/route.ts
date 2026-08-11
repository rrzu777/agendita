import { verifyMercadoPagoSignature } from '@/lib/payments/mercado-pago-signature'
import { MercadoPagoSubscriptionTransportError } from '@/lib/subscriptions/mercado-pago-client'
import {
  getSubscriptionWebhookRuntime,
  processSubscriptionWebhook,
  SubscriptionWebhookConfigurationError,
  SubscriptionWebhookValidationError,
  type SubscriptionWebhookEvent,
} from '@/lib/subscriptions/webhook'

const TOPICS = new Set<SubscriptionWebhookEvent['topic']>([
  'subscription_preapproval',
  'subscription_authorized_payment',
])

function providerId(value: unknown): string | null {
  if ((typeof value !== 'string' && typeof value !== 'number') || String(value).trim() === '') {
    return null
  }
  return String(value)
}

async function parseEvent(request: Request): Promise<SubscriptionWebhookEvent | null> {
  let payload: Record<string, unknown>
  try {
    const parsed: unknown = await request.json()
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    payload = parsed as Record<string, unknown>
  } catch {
    return null
  }

  const data = payload.data && typeof payload.data === 'object' && !Array.isArray(payload.data)
    ? payload.data as Record<string, unknown>
    : null
  const bodyId = providerId(data?.id)
  const url = new URL(request.url)
  const queryId = providerId(url.searchParams.get('data.id') ?? url.searchParams.get('id'))
  if (queryId && bodyId && queryId !== bodyId) return null
  const resourceId = queryId ?? bodyId
  const topic = payload.type
  if (
    !resourceId ||
    typeof topic !== 'string' ||
    !TOPICS.has(topic as SubscriptionWebhookEvent['topic']) ||
    typeof payload.live_mode !== 'boolean'
  ) {
    return null
  }
  return {
    topic: topic as SubscriptionWebhookEvent['topic'],
    resourceId,
    liveMode: payload.live_mode,
  }
}

export async function POST(request: Request): Promise<Response> {
  const event = await parseEvent(request)
  if (!event) return Response.json({ error: 'Invalid webhook event' }, { status: 400 })

  try {
    const runtime = getSubscriptionWebhookRuntime()
    const validSignature = verifyMercadoPagoSignature({
      resourceId: event.resourceId,
      requestId: request.headers.get('x-request-id'),
      signatureHeader: request.headers.get('x-signature'),
      secret: runtime.webhookSecret,
    })
    if (!validSignature) {
      return Response.json({ error: 'Invalid signature' }, { status: 401 })
    }

    const result = await processSubscriptionWebhook(event, runtime.dependencies)
    return Response.json({ ok: true, outcome: result.outcome })
  } catch (error) {
    if (error instanceof SubscriptionWebhookValidationError) {
      return Response.json({ error: 'Invalid webhook event' }, { status: 400 })
    }
    if (error instanceof MercadoPagoSubscriptionTransportError) {
      if (error.outcome === 'ambiguous') {
        return Response.json({ error: 'Provider temporarily unavailable' }, { status: 502 })
      }
      return Response.json({ error: 'Invalid webhook event' }, { status: 400 })
    }
    if (error instanceof SubscriptionWebhookConfigurationError) {
      return Response.json({ error: 'Webhook not configured' }, { status: 500 })
    }
    return Response.json({ error: 'Webhook processing failed' }, { status: 500 })
  }
}
