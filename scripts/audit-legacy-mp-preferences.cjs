#!/usr/bin/env node
'use strict'

// Executed directly by Node; CommonJS keeps the operational command dependency-free.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { PrismaClient } = require('@prisma/client')

const MAX_LIMIT = 100

function classifyLegacyPayment(payment) {
  // providerPreferenceId/environment/account state are not evidence that an
  // old POST was never emitted. Any pending legacy row can still represent a
  // payable preference and therefore requires operator reconciliation.
  if (payment.status === 'pending') return 'manual_review'
  return 'no_action'
}

function parseArgs(argv) {
  const value = (name) => {
    const index = argv.indexOf(name)
    return index === -1 ? undefined : argv[index + 1]
  }
  const beforeValue = value('--before')
  const limitValue = Number(value('--limit') ?? 50)
  const environment = value('--environment')
  if (!beforeValue || Number.isNaN(new Date(beforeValue).getTime())) {
    throw new Error('--before with a valid ISO timestamp is required')
  }
  if (!Number.isInteger(limitValue) || limitValue < 1 || limitValue > MAX_LIMIT) {
    throw new Error(`--limit must be between 1 and ${MAX_LIMIT}`)
  }
  if (environment && !['sandbox', 'production'].includes(environment)) {
    throw new Error('--environment must be sandbox or production')
  }
  return {
    before: new Date(beforeValue), limit: limitValue, environment,
    apply: argv.includes('--apply'),
  }
}

async function auditLegacyPreferences(prisma, options) {
  const rows = await prisma.payment.findMany({
    where: {
      provider: 'mercado_pago',
      createdAt: { lt: options.before },
      ...(options.environment ? { providerEnvironment: options.environment } : {}),
      providerIncidents: { none: { kind: { in: ['legacy_preference_reissue', 'legacy_preference_manual_review'] } } },
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: options.limit,
    select: {
      id: true, businessId: true, bookingId: true, packagePurchaseId: true,
      customerId: true, providerPaymentId: true, providerEnvironment: true,
      amount: true, currency: true, status: true, paymentType: true,
      paymentMethod: true,
      business: {
        select: {
          paymentAccounts: {
            where: { provider: 'mercado_pago', status: 'connected' },
            select: { environment: true },
          },
        },
      },
    },
  })

  const classified = rows.map((row) => ({
    row,
    classification: classifyLegacyPayment({
      ...row,
      accountConnected: row.providerEnvironment != null && row.business.paymentAccounts
        .some((account) => account.environment === row.providerEnvironment),
    }),
  }))

  if (options.apply) {
    for (const item of classified) {
      if (item.classification === 'no_action') continue
      await prisma.$transaction(async (tx) => {
        const kind = 'legacy_preference_manual_review'
        const incidentData = {
          paymentId: item.row.id,
          dedupeKey: `${kind}:${item.row.id}`,
          environment: item.row.providerEnvironment,
          kind,
          status: 'manual_review',
          resolvedAt: null,
          payload: { classification: item.classification },
        }
        await tx.paymentProviderIncident.createMany({
          data: incidentData,
          skipDuplicates: true,
        })
      })
    }
  }

  return classified.reduce((summary, item) => {
    summary[item.classification] += 1
    return summary
  }, { reissue: 0, manual_review: 0, no_action: 0 })
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const prisma = new PrismaClient()
  try {
    const summary = await auditLegacyPreferences(prisma, options)
    // Counts only: never print payment/business/customer/provider identifiers.
    console.log(JSON.stringify({ mode: options.apply ? 'apply' : 'dry-run', scanned: Object.values(summary).reduce((a, b) => a + b, 0), ...summary }))
  } finally {
    await prisma.$disconnect()
  }
}

if (require.main === module) {
  main().catch(() => {
    console.error('Legacy preference audit failed. No identifiers were emitted.')
    process.exitCode = 1
  })
}

module.exports = { MAX_LIMIT, auditLegacyPreferences, classifyLegacyPayment, parseArgs }
