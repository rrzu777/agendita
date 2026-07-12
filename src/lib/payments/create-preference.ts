import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import type { PaymentProvider, CreatePaymentInput, CreatePaymentResult } from './types'

/**
 * Base URL de la app para armar el webhookUrl. Verbatim del helper privado que
 * vivía en payments.ts — precedencia APP_URL > NEXT_PUBLIC_APP_DOMAIN, preservada
 * para no cambiar el contrato del webhook de reserva.
 */
export function getPaymentAppUrl(): string {
  const raw = process.env.APP_URL || process.env.NEXT_PUBLIC_APP_DOMAIN || ''
  const clean = raw.replace(/\/$/, '')
  if (clean.startsWith('localhost') || clean.startsWith('127.0.0.1')) {
    return `http://${clean}`
  }
  if (clean.startsWith('http')) {
    return clean
  }
  return `https://${clean}`
}

/**
 * Núcleo compartido (enfoque C): crea la preferencia MP vía el provider y
 * persiste el rawPayload en el Payment local. Contrato idéntico al inline previo.
 */
export async function createMpPreferenceForPayment(
  provider: PaymentProvider,
  input: CreatePaymentInput,
): Promise<CreatePaymentResult> {
  const result = await provider.createPayment(input)
  if (input.localPaymentId) {
    await prisma.payment.update({
      where: { id: input.localPaymentId },
      data: { rawPayload: result.rawResponse as Prisma.InputJsonValue },
    })
  }
  return result
}
