import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import type { PaymentProvider, CreatePaymentInput, CreatePaymentResult } from './types'
import { requireMercadoPagoEnvironment } from './mercado-pago-environment'
import { withMercadoPagoPaymentLocator } from './mercado-pago-provider'
import { MercadoPagoPreferenceCreationError } from './mercado-pago-provider'

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
  const providerInput = input.localPaymentId && provider.name === 'mercado_pago'
    ? {
        ...input,
        webhookUrl: withMercadoPagoPaymentLocator(input.webhookUrl, input.localPaymentId),
      }
    : input
  let result: CreatePaymentResult
  try {
    result = await provider.createPayment(providerInput)
  } catch (error) {
    const ambiguous = error instanceof MercadoPagoPreferenceCreationError
      ? error.outcome === 'ambiguous'
      : error instanceof Error && error.name === 'MercadoPagoAmbiguousPreferenceError'
    if (input.localPaymentId && ambiguous) {
      await prisma.paymentProviderIncident.upsert({
        where: { dedupeKey: `preference_creation:${input.localPaymentId}` },
        update: {},
        create: {
          paymentId: input.localPaymentId,
          dedupeKey: `preference_creation:${input.localPaymentId}`,
          environment: requireMercadoPagoEnvironment(),
          kind: 'preference_creation_ambiguous',
          status: 'manual_review',
          payload: { outcome: 'ambiguous' },
        },
      })
      throw new Error('Mercado Pago preference creation requires manual reconciliation.')
    }
    throw error
  }
  if (input.localPaymentId) {
    const providerPreferenceId =
      result.rawResponse && typeof result.rawResponse === 'object' && 'preferenceId' in result.rawResponse
        ? String(result.rawResponse.preferenceId)
        : null
    const persisted = await prisma.payment.updateMany({
      where: { id: input.localPaymentId, providerPreferenceId: null },
      data: {
        rawPayload: providerPreferenceId ? ({ preferenceId: providerPreferenceId } satisfies Prisma.InputJsonObject) : undefined,
        providerPreferenceId,
        providerEnvironment: providerPreferenceId ? requireMercadoPagoEnvironment() : null,
      },
    })
    if (persisted.count !== 1) {
      const current = await prisma.payment.findUnique({
        where: { id: input.localPaymentId }, select: { providerPreferenceId: true },
      })
      if (!providerPreferenceId || current?.providerPreferenceId !== providerPreferenceId) {
        await prisma.paymentProviderIncident.upsert({
          where: { dedupeKey: `preference_conflict:${input.localPaymentId}` },
          update: {},
          create: {
            paymentId: input.localPaymentId,
            dedupeKey: `preference_conflict:${input.localPaymentId}`,
            environment: requireMercadoPagoEnvironment(),
            providerPaymentId: null,
            kind: 'preference_conflict',
            status: 'manual_review',
            payload: { returnedPreferenceId: providerPreferenceId },
          },
        })
        throw new Error('Mercado Pago preference conflict requires manual reconciliation.')
      }
    }
  }
  return result
}
