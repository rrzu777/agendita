import {
  PaymentProvider,
  CreatePaymentInput,
  CreatePaymentResult,
  VerifyPaymentInput,
  VerifyPaymentResult,
  WebhookPaymentResult,
  RefundPaymentInput,
  RefundPaymentResult,
} from './types'

const MP_API_BASE = 'https://api.mercadopago.com'

function getAccessToken(): string {
  const token = process.env.MERCADO_PAGO_ACCESS_TOKEN
  if (!token) {
    throw new Error('MERCADO_PAGO_ACCESS_TOKEN no está configurado')
  }
  return token
}

async function mpRequest<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const token = getAccessToken()
  const url = `${MP_API_BASE}${path}`

  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(
      `Mercado Pago API error ${res.status} for ${path}: ${body}`,
    )
  }

  return res.json() as Promise<T>
}

/**
 * Creates a Mercado Pago provider instance for a specific access token.
 * Used by multi-tenant flow where each business has its own token.
 */
export function createMercadoPagoProvider(accessToken: string): PaymentProvider {
  async function mpRequestWithToken<T>(
    path: string,
    options: RequestInit = {},
  ): Promise<T> {
    const url = `${MP_API_BASE}${path}`
    const res = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    })

    if (!res.ok) {
      const body = await res.text()
      throw new Error(
        `Mercado Pago API error ${res.status} for ${path}: ${body}`,
      )
    }

    return res.json() as Promise<T>
  }

  return {
    name: 'mercado_pago',

    async createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult> {
      const paymentId = input.localPaymentId
      if (!paymentId) {
        throw new Error('localPaymentId es requerido para crear preferencia de Mercado Pago')
      }

      const preferencePayload: Record<string, unknown> = {
        items: [{
          id: paymentId,
          title: input.description,
          description: input.description,
          quantity: 1,
          unit_price: input.amount,
          currency_id: input.currency,
        }],
        external_reference: paymentId,
        notification_url: input.webhookUrl,
        back_urls: {
          success: input.returnUrl,
          failure: input.returnUrl,
          pending: input.returnUrl,
        },
      }

      if (input.customerEmail) {
        preferencePayload.payer = { email: input.customerEmail }
      }
      if (input.metadata) {
        preferencePayload.metadata = input.metadata
      }

      const preference = await mpRequestWithToken<{
        id: string; init_point: string; sandbox_init_point: string
      }>('/checkout/preferences', {
        method: 'POST',
        body: JSON.stringify(preferencePayload),
      })

      return {
        paymentId,
        providerPaymentId: null,
        redirectUrl: preference.init_point,
        status: 'pending',
        rawResponse: {
          preferenceId: preference.id,
          init_point: preference.init_point,
          sandbox_init_point: preference.sandbox_init_point,
        },
      }
    },

    async verifyPayment(input: VerifyPaymentInput): Promise<VerifyPaymentResult> {
      const mpPayment = await mpRequestWithToken<{
        id: string; status: string; transaction_amount: number; date_approved: string | null
      }>(`/v1/payments/${input.providerPaymentId}`)

      const statusMap: Record<string, VerifyPaymentResult['status']> = {
        approved: 'approved', pending: 'pending', in_process: 'pending',
        rejected: 'rejected', cancelled: 'cancelled', refunded: 'refunded',
      }

      return {
        status: statusMap[mpPayment.status] ?? 'rejected',
        amount: mpPayment.transaction_amount,
        paidAt: mpPayment.date_approved ? new Date(mpPayment.date_approved) : null,
        rawResponse: mpPayment,
      }
    },

    async handleWebhook(payload: unknown): Promise<WebhookPaymentResult> {
      const data = payload as Record<string, unknown> | null
      const dataField = data?.data as Record<string, unknown> | undefined
      const mpPaymentId = (dataField?.id ?? data?.id) as string | undefined
      if (!mpPaymentId) {
        throw new Error('Invalid webhook payload: missing payment id')
      }

      const mpPayment = await mpRequestWithToken<{
        id: string; status: string; transaction_amount: number; date_approved: string | null; external_reference: string | null
      }>(`/v1/payments/${mpPaymentId}`)

      const statusMap: Record<string, WebhookPaymentResult['status']> = {
        approved: 'approved', pending: 'pending', in_process: 'pending',
        rejected: 'rejected', cancelled: 'cancelled', refunded: 'refunded',
      }

      return {
        status: statusMap[mpPayment.status] ?? 'rejected',
        paymentId: mpPayment.external_reference ?? mpPayment.id,
        providerPaymentId: mpPayment.id,
        amount: mpPayment.transaction_amount,
        paidAt: mpPayment.date_approved ? new Date(mpPayment.date_approved) : null,
        rawPayload: mpPayment,
      }
    },

    async refundPayment(input: RefundPaymentInput): Promise<RefundPaymentResult> {
      const refund = await mpRequestWithToken<{ id: number | string; status: string }>(
        `/v1/payments/${input.providerPaymentId}/refunds`,
        {
          method: 'POST',
          body: JSON.stringify({ amount: input.amount }),
          headers: { 'X-Idempotency-Key': input.idempotencyKey },
        },
      )
      const statusMap: Record<string, RefundPaymentResult['status']> = {
        approved: 'refunded', refunded: 'refunded', pending: 'pending', in_process: 'pending',
      }
      return {
        refundId: String(refund.id),
        status: statusMap[refund.status] ?? 'failed',
        rawResponse: refund,
      }
    },
  }
}

/** Legacy global provider (used by non-multi-tenant paths). Lazily created. */
let _globalProvider: PaymentProvider | null = null

function getGlobalProvider(): PaymentProvider {
  if (!_globalProvider) {
    const token = process.env.MERCADO_PAGO_ACCESS_TOKEN
    if (!token) {
      throw new Error('MERCADO_PAGO_ACCESS_TOKEN no está configurado')
    }
    _globalProvider = createMercadoPagoProvider(token)
  }
  return _globalProvider
}

export const mercadoPagoPaymentProvider: PaymentProvider = {
  name: 'mercado_pago',
  createPayment(input: CreatePaymentInput) { return getGlobalProvider().createPayment(input) },
  verifyPayment(input: VerifyPaymentInput) { return getGlobalProvider().verifyPayment(input) },
  handleWebhook(payload: unknown) { return getGlobalProvider().handleWebhook(payload) },
  refundPayment(input: RefundPaymentInput) { return getGlobalProvider().refundPayment(input) },
}
