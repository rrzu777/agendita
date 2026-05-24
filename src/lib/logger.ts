/**
 * Structured JSON logger for server-side logging.
 * All logs go through this module only — console is used internally.
 * Never log tokens, secrets, raw payment payloads, or full emails.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export type LogEvent =
  | 'booking.created'
  | 'payment.initiated'
  | 'payment.approved'
  | 'payment.failed'
  | 'webhook.received'
  | 'webhook.rejected'
  | 'auth.failure'
  | 'tenant.resolve.failed'
  | 'rate_limit.blocked'

export type LogFields = {
  level: LogLevel
  event: LogEvent | string
  message: string
  businessId?: string
  userId?: string
  bookingId?: string
  paymentId?: string
  requestId?: string
  metadata?: Record<string, unknown>
}

// Fields that should never appear in logs
const SECRET_FIELDS = new Set([
  'token',
  'secret',
  'password',
  'api_key',
  'access_token',
  'authorization',
  'cookie',
  'signature',
  'rawpayload',
  'rawresponse',
])

function sanitizeMetadata(meta: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!meta) return undefined
  const sanitized: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(meta)) {
    if (SECRET_FIELDS.has(key.toLowerCase())) {
      sanitized[key] = '[REDACTED]'
    } else if (
      typeof value === 'string' &&
      value.length > 5 &&
      value.includes('@') &&
      value.indexOf('@') > 0 &&
      value.lastIndexOf('.') > value.indexOf('@')
    ) {
      // Redact email: keep first 2 chars of local part
      const atIdx = value.indexOf('@')
      const local = value.slice(0, atIdx)
      const domain = value.slice(atIdx + 1)
      sanitized[key] = `${local.slice(0, 2)}***@${domain}`
    } else {
      sanitized[key] = value
    }
  }
  return sanitized
}

function formatLog(fields: LogFields): string {
  const { level, event, message, businessId, userId, bookingId, paymentId, requestId, metadata } = fields
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    event,
    message,
    ...(businessId && { businessId }),
    ...(userId && { userId }),
    ...(bookingId && { bookingId }),
    ...(paymentId && { paymentId }),
    ...(requestId && { requestId }),
    ...(metadata && Object.keys(metadata).length > 0 && { metadata: sanitizeMetadata(metadata) }),
  }
  return JSON.stringify(entry)
}

function emit(level: LogLevel, event: string, message: string, extra?: Omit<LogFields, 'level' | 'event' | 'message'>) {
  const fields: LogFields = { level, event, message, ...extra }
  const line = formatLog(fields)
  if (level === 'error') {
    console.error(line)
  } else if (level === 'warn') {
    console.warn(line)
  } else {
    console.log(line)
  }
}

export const logger = {
  debug(event: string, message: string, extra?: Omit<LogFields, 'level' | 'event' | 'message'>) {
    emit('debug', event, message, extra)
  },
  info(event: string, message: string, extra?: Omit<LogFields, 'level' | 'event' | 'message'>) {
    emit('info', event, message, extra)
  },
  warn(event: string, message: string, extra?: Omit<LogFields, 'level' | 'event' | 'message'>) {
    emit('warn', event, message, extra)
  },
  error(event: string, message: string, extra?: Omit<LogFields, 'level' | 'event' | 'message'>) {
    emit('error', event, message, extra)
  },
  booking: {
    created(bookingId: string, businessId: string, customerEmail?: string) {
      emit('info', 'booking.created', `Booking created: ${bookingId}`, {
        bookingId,
        businessId,
        metadata: customerEmail ? { customerEmail: '[REDACTED]' } : undefined,
      })
    },
  },
  payment: {
    initiated(paymentId: string, bookingId: string, businessId: string) {
      emit('info', 'payment.initiated', `Payment initiated: ${paymentId}`, { paymentId, bookingId, businessId })
    },
    approved(paymentId: string, bookingId: string, businessId: string) {
      emit('info', 'payment.approved', `Payment approved: ${paymentId}`, { paymentId, bookingId, businessId })
    },
    failed(paymentId: string, bookingId: string, businessId: string, reason?: string) {
      emit('warn', 'payment.failed', `Payment failed: ${paymentId}`, {
        paymentId,
        bookingId,
        businessId,
        metadata: reason ? { reason } : undefined,
      })
    },
  },
  webhook: {
    received(topic: string, requestId?: string) {
      emit('info', 'webhook.received', `Webhook received: ${topic}`, {
        requestId,
        metadata: { topic },
      })
    },
    rejected(topic: string, reason: string, requestId?: string) {
      emit('warn', 'webhook.rejected', `Webhook rejected: ${topic}`, {
        requestId,
        metadata: { topic, reason },
      })
    },
  },
  auth: {
    failure(reason: string, requestId?: string, userId?: string) {
      emit('warn', 'auth.failure', `Auth failure: ${reason}`, { requestId, userId })
    },
  },
  tenant: {
    resolveFailed(hostname: string, reason: string) {
      emit('warn', 'tenant.resolve.failed', `Tenant resolution failed for ${hostname}`, {
        metadata: { hostname, reason },
      })
    },
  },
  rateLimit: {
    blocked(action: string, ip: string, businessId?: string) {
      emit('warn', 'rate_limit.blocked', `Rate limit blocked: ${action}`, {
        businessId,
        metadata: { action, ip },
      })
    },
  },
}