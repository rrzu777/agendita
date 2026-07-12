export interface CreatePaymentInput {
  amount: number
  currency: string
  /** Reserva asociada, si aplica. Ningún provider lo lee hoy (usan
   *  localPaymentId como external_reference); la compra de paquete lo omite. */
  bookingId?: string
  description: string
  returnUrl: string
  webhookUrl: string
  /** ID del Payment local en DB, usado como external_reference para MP. */
  localPaymentId?: string
  /** Email del pagador para asociar a la preferencia de MP. */
  customerEmail?: string | null
  /** Metadata adicional que el provider puede incluir (ej. bookingId, businessId). */
  metadata?: Record<string, string>
}

export interface CreatePaymentResult {
  paymentId: string
  providerPaymentId: string | null
  redirectUrl: string | null
  status: 'pending' | 'approved' | 'rejected'
  rawResponse: unknown
}

export interface VerifyPaymentInput {
  paymentId: string
  providerPaymentId: string
}

export interface VerifyPaymentResult {
  status: 'approved' | 'rejected' | 'pending' | 'cancelled' | 'refunded'
  amount: number
  paidAt: Date | null
  rawResponse: unknown
}

export interface WebhookPaymentResult {
  status: 'approved' | 'rejected' | 'pending' | 'cancelled' | 'refunded'
  paymentId: string
  providerPaymentId: string
  amount: number
  paidAt: Date | null
  rawPayload: unknown
}

export interface RefundPaymentInput {
  /** id del pago en el provider (MP payment id). */
  providerPaymentId: string
  /** monto a reembolsar (parcial permitido). */
  amount: number
  currency: string
  /** clave determinística para dedupe del refund en el provider. */
  idempotencyKey: string
  /** token OAuth del negocio (MP per-tenant); ignorado por manual/mock. */
  accessToken?: string
}

export interface RefundPaymentResult {
  /** id del refund en el provider; null para manual/mock. */
  refundId: string | null
  status: 'refunded' | 'pending' | 'failed'
  rawResponse: unknown
}

export interface PaymentProvider {
  name: string
  createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult>
  verifyPayment(input: VerifyPaymentInput): Promise<VerifyPaymentResult>
  handleWebhook(payload: unknown): Promise<WebhookPaymentResult>
  refundPayment(input: RefundPaymentInput): Promise<RefundPaymentResult>
}
