export interface CreatePaymentInput {
  amount: number
  currency: string
  bookingId: string
  description: string
  returnUrl: string
  webhookUrl: string
}

export interface CreatePaymentResult {
  paymentId: string
  providerPaymentId: string | null
  redirectUrl: string | null
  status: 'pending' | 'approved' | 'rejected'
  rawResponse: any
}

export interface VerifyPaymentInput {
  paymentId: string
  providerPaymentId: string
}

export interface VerifyPaymentResult {
  status: 'approved' | 'rejected' | 'pending' | 'cancelled' | 'refunded'
  amount: number
  paidAt: Date | null
  rawResponse: any
}

export interface WebhookPaymentResult {
  status: 'approved' | 'rejected' | 'pending' | 'cancelled' | 'refunded'
  paymentId: string
  providerPaymentId: string
  amount: number
  paidAt: Date | null
  rawPayload: any
}

export interface PaymentProvider {
  name: string
  createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult>
  verifyPayment(input: VerifyPaymentInput): Promise<VerifyPaymentResult>
  handleWebhook(payload: unknown): Promise<WebhookPaymentResult>
}
