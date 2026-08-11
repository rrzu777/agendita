import type { MercadoPagoEnvironment, Prisma } from '@prisma/client'

type IncidentTx = Pick<Prisma.TransactionClient, 'payment' | 'paymentProviderIncident'>

type ProviderPayload = Prisma.InputJsonObject & { id: string; status: string }

function sanitaryIncidentPayload(payload: ProviderPayload): Prisma.InputJsonObject {
  const allowed = [
    'id', 'status', 'statusDetail', 'transactionAmount', 'currencyId',
    'dateApproved', 'dateCreated', 'externalReference', 'collectorId',
  ] as const
  return Object.fromEntries(
    allowed.flatMap((key) => key in payload ? [[key, payload[key] as Prisma.InputJsonValue]] : []),
  )
}

/**
 * Atomically binds the first approved provider payment to the local Payment.
 * A second real approval is money received, so it is committed as a sanitary
 * manual-review incident rather than overwriting the winner or rolling back.
 */
export async function claimApprovedProviderPayment(
  tx: IncidentTx,
  input: {
    paymentId: string
    environment: MercadoPagoEnvironment
    providerPaymentId: string
    payload: ProviderPayload
  },
): Promise<{ kind: 'claimed' } | { kind: 'conflict'; winnerProviderPaymentId: string | null }> {
  const claimed = await tx.payment.updateMany({
    where: {
      id: input.paymentId,
      OR: [{ providerPaymentId: null }, { providerPaymentId: input.providerPaymentId }],
    },
    data: {
      providerPaymentId: input.providerPaymentId,
      rawPayload: input.payload,
    },
  })
  if (claimed.count === 1) return { kind: 'claimed' }

  const current = await tx.payment.findUnique({
    where: { id: input.paymentId },
    select: { providerPaymentId: true },
  })
  await tx.paymentProviderIncident.upsert({
    where: {
      environment_providerPaymentId: {
        environment: input.environment,
        providerPaymentId: input.providerPaymentId,
      },
    },
    update: {},
    create: {
      paymentId: input.paymentId,
      dedupeKey: `approved:${input.environment}:${input.providerPaymentId}`,
      environment: input.environment,
      providerPaymentId: input.providerPaymentId,
      kind: 'distinct_approved_overpayment',
      status: 'manual_review',
      payload: sanitaryIncidentPayload(input.payload),
    },
  })
  return { kind: 'conflict', winnerProviderPaymentId: current?.providerPaymentId ?? null }
}
