import { PaymentProvider, CreatePaymentInput, CreatePaymentResult, VerifyPaymentInput, VerifyPaymentResult, WebhookPaymentResult } from './types'

export const mockPaymentProvider: PaymentProvider = {
  name: 'mock',

  async createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult> {
    // Simulate API delay
    await new Promise(resolve => setTimeout(resolve, 500))

    const paymentId = `mock-pay-${Date.now()}`

    return {
      paymentId,
      providerPaymentId: paymentId,
      redirectUrl: null, // Mock doesn't redirect
      status: 'pending',
      rawResponse: { mock: true, input },
    }
  },

  async verifyPayment(input: VerifyPaymentInput): Promise<VerifyPaymentResult> {
    await new Promise(resolve => setTimeout(resolve, 300))

    // Mock always approves for development
    return {
      status: 'approved',
      amount: 0, // Will be filled by caller
      paidAt: new Date(),
      rawResponse: { mock: true, verified: true },
    }
  },

  async handleWebhook(payload: unknown): Promise<WebhookPaymentResult> {
    // Mock webhooks are not expected, but handle gracefully
    const data = payload as any

    return {
      status: 'approved',
      paymentId: data?.paymentId || 'unknown',
      providerPaymentId: data?.providerPaymentId || 'unknown',
      amount: data?.amount || 0,
      paidAt: new Date(),
      rawPayload: payload,
    }
  },
}
