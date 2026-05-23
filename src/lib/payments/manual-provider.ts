import { PaymentProvider, CreatePaymentInput, CreatePaymentResult, VerifyPaymentInput, VerifyPaymentResult, WebhookPaymentResult } from './types'

export const manualPaymentProvider: PaymentProvider = {
  name: 'manual',

  async createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult> {
    // Manual payments don't create a provider transaction
    const paymentId = `manual-pay-${Date.now()}`

    return {
      paymentId,
      providerPaymentId: null,
      redirectUrl: null,
      status: 'pending',
      rawResponse: { manual: true, input },
    }
  },

  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- required by PaymentProvider interface
  async verifyPayment(_input: VerifyPaymentInput): Promise<VerifyPaymentResult> {
    // Manual payments are verified by admin action, not by provider
    return {
      status: 'pending',
      amount: 0,
      paidAt: null,
      rawResponse: { manual: true, message: 'Manual payments must be confirmed by admin' },
    }
  },

  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- required by PaymentProvider interface
  async handleWebhook(_payload: unknown): Promise<WebhookPaymentResult> {
    // Manual payments don't use webhooks
    throw new Error('Manual payments do not support webhooks')
  },
}
