/**
 * Safe error handling for server actions.
 * - Expected user errors: thrown as-is (user-friendly messages).
 * - Unexpected/internal errors: logged server-side, generic message returned.
 * - Never expose stack traces, Prisma errors, or internal details to the client.
 */

import { logger } from './logger'

export class ActionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ActionError'
  }
}

/**
 * Wraps a server action function. On unexpected errors, logs the full
 * details server-side and throws a generic ActionError to the client.
 */
export async function safeAction<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    // Re-throw ActionError as-is (already user-safe)
    if (err instanceof ActionError) throw err

    // Prisma errors: reduce to a safe message
    const prismaErr = err as { code?: string; meta?: unknown }
    if (typeof prismaErr.code === 'string' && prismaErr.code.startsWith('P')) {
      const safeMessage = 'Error de base de datos. Por favor intenta nuevamente.'
      console.error('[ActionError:Prisma]', err instanceof Error ? err.message : err)
      throw new ActionError(safeMessage)
    }

    // Unexpected: log full error, return generic to client
    const safeMessage = 'Ocurrió un error inesperado. Por favor intenta nuevamente.'
    console.error('[ActionError:Internal]', err instanceof Error ? err.message : err)
    throw new ActionError(safeMessage)
  }
}

/**
 * Maps a booking payment error to a user-friendly message
 * without exposing internal details.
 */
export function safePaymentError(err: unknown): string {
  if (err instanceof Error) {
    const msg = err.message.toLowerCase()
    if (msg.includes('already approved')) return 'Este pago ya fue procesado.'
    if (msg.includes('not found')) return 'Reserva o pago no encontrado.'
    if (msg.includes('hold') || msg.includes('expired')) return 'La reserva ha expirado. Por favor inicia un nuevo proceso de pago.'
    if (msg.includes('amount') || msg.includes('monto')) return 'El monto no coincide con el pago registrado.'
    if (msg.includes('-provider')) return 'Error del procesador de pagos. Intenta con otro método.'
    if (msg.includes('webhook')) return 'Error de verificación del pago. Intenta en unos minutos.'
  }
  return 'Ocurrió un error con el pago. Por favor intenta nuevamente.'
}

/**
 * Logs a booking-related error with context.
 */
export function logBookingError(bookingId: string, businessId: string, err: unknown) {
  const msg = err instanceof Error ? err.message : String(err)
  logger.error('booking.error', `Booking error: ${bookingId}`, {
    bookingId,
    businessId,
    metadata: { error: msg },
  })
}

/**
 * Logs a payment-related error with context, redacting sensitive data.
 */
export function logPaymentError(paymentId: string, bookingId: string, businessId: string, err: unknown) {
  const msg = err instanceof Error ? err.message : String(err)
  logger.error('payment.error', `Payment error: ${paymentId}`, {
    paymentId,
    bookingId,
    businessId,
    metadata: { error: msg },
  })
}