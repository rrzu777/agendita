import 'server-only'

import {
  type MpInvoice,
  type MpSubscription,
  MercadoPagoSubscriptionContractError,
  normalizeMpInvoice,
  normalizeMpSubscription,
} from './mercado-pago-mappers'

const MP_API_BASE = 'https://api.mercadopago.com'
export const MP_SUBSCRIPTION_REQUEST_TIMEOUT_MS = 5_000
const MP_INVOICE_PAGE_SIZE = 20
const MP_INVOICE_RECONCILIATION_CAP = 100

export type MpSubscriptionsEnvironment = 'sandbox' | 'production'

export type MpSubscriptionClientConfig = {
  accessToken: string
  webhookSecret: string
  callbackUrl: string
  environment: MpSubscriptionsEnvironment
}

export type CreatePlanInput = {
  name: string
  amount: number
  externalReference: string
}

export type CreateSubscriptionInput = {
  planId: string
  externalReference: string
  payerEmail?: string
  amount?: number
  startDate?: Date
}

export type MpPlan = {
  id: string
  status: string | null
  externalReference: string | null
  reason: string | null
  collectorId: string | null
  amount: number
  currency: 'CLP'
  frequency: 1
  frequencyType: 'months'
}

export type MpSubscriptionClient = {
  createPlan(input: CreatePlanInput): Promise<MpPlan>
  getPlan(id: string): Promise<MpPlan>
  getCurrentAccountId(): Promise<string>
  createSubscription(input: CreateSubscriptionInput): Promise<MpSubscription>
  getSubscription(id: string): Promise<MpSubscription>
  cancelSubscription(id: string): Promise<MpSubscription>
  getInvoice(id: string): Promise<MpInvoice>
  searchInvoices(subscriptionId: string): Promise<MpInvoice[]>
}

export type MercadoPagoSubscriptionRequestOutcome =
  | 'definitive_rejection'
  | 'ambiguous'

export class MercadoPagoSubscriptionTransportError extends Error {
  readonly status: number | null
  readonly outcome: MercadoPagoSubscriptionRequestOutcome

  constructor(status: number | null = null) {
    super(
      status !== null
        ? `Mercado Pago subscriptions request failed (HTTP ${status}).`
        : 'Mercado Pago subscriptions request failed.',
    )
    this.name = 'MercadoPagoSubscriptionTransportError'
    this.status = status
    this.outcome = status !== null && status >= 400 && status < 500 && status !== 408
      ? 'definitive_rejection'
      : 'ambiguous'
  }
}

function validateConfig(config: MpSubscriptionClientConfig): void {
  if (!config.accessToken || !config.webhookSecret) {
    throw new Error('Mercado Pago subscriptions client configuration is incomplete.')
  }
  if (config.environment !== 'sandbox' && config.environment !== 'production') {
    throw new Error('Mercado Pago subscriptions environment must be explicit.')
  }
  try {
    const callbackUrl = new URL(config.callbackUrl)
    if (callbackUrl.protocol !== 'https:') throw new Error('invalid protocol')
  } catch {
    throw new Error('Mercado Pago subscriptions callback URL is invalid.')
  }
}

function requiredString(value: string, field: string): string {
  if (!value.trim()) throw new Error(`${field} is required.`)
  return value
}

function requireMonthlyClp(amount: number): void {
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new Error('Mercado Pago subscriptions amount must be a positive integer CLP value.')
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new MercadoPagoSubscriptionContractError()
  }
  return value as Record<string, unknown>
}

function providerId(value: unknown): string {
  if ((typeof value !== 'string' && typeof value !== 'number') || String(value).trim() === '') {
    throw new MercadoPagoSubscriptionContractError()
  }
  return String(value)
}

function optionalProviderString(value: unknown): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') throw new MercadoPagoSubscriptionContractError()
  return value
}

function optionalProviderId(value: unknown): string | null {
  if (value === undefined || value === null) return null
  return providerId(value)
}

function normalizePlan(response: unknown): MpPlan {
  const raw = asRecord(response)
  return {
    id: providerId(raw.id),
    status: typeof raw.status === 'string' ? raw.status : null,
    externalReference: raw.external_reference === undefined || raw.external_reference === null
      ? null
      : typeof raw.external_reference === 'string' && raw.external_reference.trim()
        ? raw.external_reference
        : (() => { throw new MercadoPagoSubscriptionContractError() })(),
    reason: optionalProviderString(raw.reason),
    collectorId: optionalProviderId(raw.collector_id),
    ...(() => {
      const recurring = asRecord(raw.auto_recurring)
      const amount = Number(recurring.transaction_amount)
      if (!Number.isSafeInteger(amount) || amount <= 0 || recurring.currency_id !== 'CLP' ||
          recurring.frequency !== 1 || recurring.frequency_type !== 'months') {
        throw new MercadoPagoSubscriptionContractError()
      }
      return { amount, currency: 'CLP' as const, frequency: 1 as const, frequencyType: 'months' as const }
    })(),
  }
}

function timeoutSignal(): AbortSignal {
  if (typeof AbortSignal.timeout === 'function') {
    return AbortSignal.timeout(MP_SUBSCRIPTION_REQUEST_TIMEOUT_MS)
  }
  const controller = new AbortController()
  setTimeout(() => controller.abort(), MP_SUBSCRIPTION_REQUEST_TIMEOUT_MS)
  return controller.signal
}

export function createMpSubscriptionClient(
  config: MpSubscriptionClientConfig,
): MpSubscriptionClient {
  validateConfig(config)

  async function request(path: string, init: RequestInit = {}): Promise<Record<string, unknown>> {
    let response: Response
    try {
      response = await fetch(`${MP_API_BASE}${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${config.accessToken}`,
          'Content-Type': 'application/json',
          ...init.headers,
        },
        signal: timeoutSignal(),
      })
    } catch {
      throw new MercadoPagoSubscriptionTransportError()
    }

    if (!response.ok) {
      // Do not read, log, or attach an upstream body: it can contain provider
      // data and must never appear in an application error.
      throw new MercadoPagoSubscriptionTransportError(response.status)
    }

    try {
      return asRecord(await response.json())
    } catch (error) {
      if (error instanceof MercadoPagoSubscriptionContractError) throw error
      throw new MercadoPagoSubscriptionContractError()
    }
  }

  return {
    async createPlan(input) {
      requiredString(input.name, 'Plan name')
      requiredString(input.externalReference, 'External reference')
      requireMonthlyClp(input.amount)
      const raw = await request('/preapproval_plan', {
        method: 'POST',
        body: JSON.stringify({
          reason: input.name,
          external_reference: input.externalReference,
          back_url: config.callbackUrl,
          auto_recurring: {
            frequency: 1,
            frequency_type: 'months',
            transaction_amount: input.amount,
            currency_id: 'CLP',
          },
        }),
      })
      return normalizePlan(raw)
    },

    async getPlan(id) {
      return normalizePlan(
        await request(`/preapproval_plan/${encodeURIComponent(requiredString(id, 'Plan id'))}`),
      )
    },

    async getCurrentAccountId() {
      return providerId((await request('/users/me')).id)
    },

    async createSubscription(input) {
      requiredString(input.planId, 'Plan id')
      requiredString(input.externalReference, 'External reference')
      if ((input.amount === undefined) !== (input.startDate === undefined)) {
        throw new Error('Subscription amount and start date must be provided together.')
      }
      const body: Record<string, unknown> = {
        preapproval_plan_id: input.planId,
        external_reference: input.externalReference,
        back_url: config.callbackUrl,
      }
      if (input.payerEmail) body.payer_email = input.payerEmail
      if (input.amount !== undefined && input.startDate) {
        requireMonthlyClp(input.amount)
        if (Number.isNaN(input.startDate.getTime())) {
          throw new Error('Subscription start date is invalid.')
        }
        body.auto_recurring = {
          frequency: 1,
          frequency_type: 'months',
          transaction_amount: input.amount,
          currency_id: 'CLP',
          start_date: input.startDate.toISOString(),
        }
      }
      const subscription = normalizeMpSubscription(
        await request('/preapproval', { method: 'POST', body: JSON.stringify(body) }),
      )
      if (subscription.providerStatus === 'pending' && !subscription.checkoutUrl) {
        throw new MercadoPagoSubscriptionContractError()
      }
      return subscription
    },

    async getSubscription(id) {
      return normalizeMpSubscription(
        await request(`/preapproval/${encodeURIComponent(requiredString(id, 'Subscription id'))}`),
      )
    },

    async cancelSubscription(id) {
      return normalizeMpSubscription(
        await request(`/preapproval/${encodeURIComponent(requiredString(id, 'Subscription id'))}`, {
          method: 'PUT',
          body: JSON.stringify({ status: 'canceled' }),
        }),
      )
    },

    async getInvoice(id) {
      return normalizeMpInvoice(
        await request(`/authorized_payments/${encodeURIComponent(requiredString(id, 'Invoice id'))}`),
      )
    },

    async searchInvoices(subscriptionId) {
      const preapprovalId = requiredString(subscriptionId, 'Subscription id')
      const invoices: MpInvoice[] = []
      const seen = new Set<string>()
      for (let offset = 0; offset <= MP_INVOICE_RECONCILIATION_CAP; offset += MP_INVOICE_PAGE_SIZE) {
        const query = new URLSearchParams({
          preapproval_id: preapprovalId,
          limit: String(MP_INVOICE_PAGE_SIZE),
          offset: String(offset),
        })
        const raw = await request(`/authorized_payments/search?${query.toString()}`)
        if (!Array.isArray(raw.results)) throw new MercadoPagoSubscriptionContractError()
        const paging = asRecord(raw.paging)
        const total = Number(paging.total)
        const responseOffset = Number(paging.offset)
        const limit = Number(paging.limit)
        if (
          !Number.isSafeInteger(total) || total < 0 || total > MP_INVOICE_RECONCILIATION_CAP ||
          responseOffset !== offset || limit !== MP_INVOICE_PAGE_SIZE ||
          raw.results.length > MP_INVOICE_PAGE_SIZE ||
          (raw.results.length === 0 && invoices.length < total)
        ) {
          throw new MercadoPagoSubscriptionContractError()
        }
        for (const rawInvoice of raw.results) {
          const invoice = normalizeMpInvoice(rawInvoice)
          if (seen.has(invoice.id)) throw new MercadoPagoSubscriptionContractError()
          seen.add(invoice.id)
          invoices.push(invoice)
        }
        if (invoices.length === total) return invoices
        if (invoices.length > total) throw new MercadoPagoSubscriptionContractError()
      }
      throw new MercadoPagoSubscriptionContractError()
    },
  }
}
