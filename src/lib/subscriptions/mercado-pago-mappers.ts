import 'server-only'

export class MercadoPagoSubscriptionContractError extends Error {
  constructor(message = 'Mercado Pago subscriptions response violates the expected contract.') {
    super(message)
    this.name = 'MercadoPagoSubscriptionContractError'
  }
}

export type MpSubscriptionStatus =
  | 'active'
  | 'pending'
  | 'suspended'
  | 'canceled'
  | 'ignored'

export type MpInvoiceStatus = 'approved' | 'pending' | 'failed' | 'ignored'

export type MpSubscription = {
  id: string
  status: MpSubscriptionStatus
  externalReference: string | null
  checkoutUrl: string | null
  amount: number
  currency: 'CLP'
  frequency: 1
  frequencyType: 'months'
  nextPaymentAt: Date | null
}

export type MpInvoice = {
  id: string
  subscriptionId: string | null
  status: MpInvoiceStatus
  amount: number
  currency: 'CLP'
  approvedAt: Date | null
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new MercadoPagoSubscriptionContractError()
  }
  return value as Record<string, unknown>
}

function requiredId(value: unknown): string {
  if ((typeof value !== 'string' && typeof value !== 'number') || String(value).trim() === '') {
    throw new MercadoPagoSubscriptionContractError()
  }
  return String(value)
}

function optionalString(value: unknown): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') throw new MercadoPagoSubscriptionContractError()
  return value
}

function optionalDate(value: unknown): Date | null {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string') throw new MercadoPagoSubscriptionContractError()
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})$/.exec(value)
  if (!match) throw new MercadoPagoSubscriptionContractError()

  const [, yearText, monthText, dayText, hourText, minuteText, secondText, , offset] = match
  const year = Number(yearText)
  const month = Number(monthText)
  const day = Number(dayText)
  const hour = Number(hourText)
  const minute = Number(minuteText)
  const second = Number(secondText)
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate()
  const offsetIsValid = offset === 'Z' || (
    Number(offset.slice(1, 3)) <= 23 && Number(offset.slice(4, 6)) <= 59
  )
  if (
    month < 1 || month > 12 || day < 1 || day > daysInMonth ||
    hour > 23 || minute > 59 || second > 59 || !offsetIsValid
  ) {
    throw new MercadoPagoSubscriptionContractError()
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) throw new MercadoPagoSubscriptionContractError()
  return date
}

function optionalHostedCheckoutUrl(value: unknown): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') throw new MercadoPagoSubscriptionContractError()
  try {
    const url = new URL(value)
    const host = url.hostname.toLowerCase()
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      (host !== 'mercadopago.cl' && !host.endsWith('.mercadopago.cl'))
    ) {
      throw new MercadoPagoSubscriptionContractError()
    }
    return url.toString()
  } catch (error) {
    if (error instanceof MercadoPagoSubscriptionContractError) throw error
    throw new MercadoPagoSubscriptionContractError()
  }
}

function positiveClpInteger(value: unknown): number {
  const amount =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && /^\d+$/.test(value)
        ? Number(value)
        : Number.NaN
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new MercadoPagoSubscriptionContractError()
  }
  return amount
}

function monthlyClp(raw: Record<string, unknown>): {
  amount: number
  currency: 'CLP'
  frequency: 1
  frequencyType: 'months'
} {
  const recurring = asRecord(raw.auto_recurring)
  const amount = positiveClpInteger(recurring.transaction_amount)
  if (recurring.currency_id !== 'CLP') {
    throw new MercadoPagoSubscriptionContractError()
  }
  if (recurring.frequency !== 1 || recurring.frequency_type !== 'months') {
    throw new MercadoPagoSubscriptionContractError()
  }
  return { amount, currency: 'CLP', frequency: 1, frequencyType: 'months' }
}

function invoiceAmount(raw: Record<string, unknown>): { amount: number; currency: 'CLP' } {
  const amount = positiveClpInteger(raw.transaction_amount)
  if (raw.currency_id !== 'CLP') throw new MercadoPagoSubscriptionContractError()
  return { amount, currency: 'CLP' }
}

const SUBSCRIPTION_STATUS: Record<string, MpSubscriptionStatus> = {
  authorized: 'active',
  active: 'active',
  pending: 'pending',
  paused: 'suspended',
  canceled: 'canceled',
}

const INVOICE_STATUS: Record<string, MpInvoiceStatus> = {
  approved: 'approved',
  pending: 'pending',
  scheduled: 'pending',
  in_process: 'pending',
  rejected: 'failed',
  cancelled: 'failed',
}

export function normalizeMpSubscription(response: unknown): MpSubscription {
  const raw = asRecord(response)
  const status = typeof raw.status === 'string' ? SUBSCRIPTION_STATUS[raw.status] ?? 'ignored' : 'ignored'

  return {
    id: requiredId(raw.id),
    status,
    externalReference: optionalString(raw.external_reference),
    checkoutUrl: optionalHostedCheckoutUrl(raw.init_point),
    ...monthlyClp(raw),
    nextPaymentAt: optionalDate(raw.next_payment_date),
  }
}

export function normalizeMpInvoice(response: unknown): MpInvoice {
  const raw = asRecord(response)
  const payment = raw.payment && typeof raw.payment === 'object' && !Array.isArray(raw.payment)
    ? raw.payment as Record<string, unknown>
    : null
  const providerStatus = payment?.status ?? raw.status
  const status = typeof providerStatus === 'string'
    ? INVOICE_STATUS[providerStatus] ?? 'ignored'
    : 'ignored'

  return {
    id: requiredId(raw.id),
    subscriptionId: optionalString(raw.preapproval_id),
    status,
    ...invoiceAmount(raw),
    approvedAt: optionalDate(raw.date_approved),
  }
}
