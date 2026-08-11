#!/usr/bin/env node
'use strict'

// Executed directly by Node; CommonJS keeps the operational command dependency-free.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { PrismaClient } = require('@prisma/client')

const MAX_LIMIT = 100

function classifyLegacyPayment(payment) {
  const exactlyOneOwner = Boolean(payment.bookingId) !== Boolean(payment.packagePurchaseId)
  if (!exactlyOneOwner || !payment.accountConnected) return 'manual_review'
  if (payment.status === 'pending' && !payment.providerPaymentId) return 'reissue'
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
      providerPreferenceId: { not: null },
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
      if (item.classification === 'no_action' || !item.row.providerEnvironment) continue
      await prisma.$transaction(async (tx) => {
        const kind = item.classification === 'reissue'
          ? 'legacy_preference_reissue'
          : 'legacy_preference_manual_review'
        if (item.classification === 'reissue') {
          const cancelled = await tx.payment.updateMany({
            where: { id: item.row.id, status: 'pending', providerPaymentId: null },
            data: { status: 'cancelled' },
          })
          if (cancelled.count !== 1) return
          await tx.payment.create({
            data: {
              businessId: item.row.businessId,
              bookingId: item.row.bookingId,
              packagePurchaseId: item.row.packagePurchaseId,
              customerId: item.row.customerId,
              provider: 'mercado_pago',
              providerEnvironment: item.row.providerEnvironment,
              amount: item.row.amount,
              currency: item.row.currency,
              status: 'pending',
              paymentType: item.row.paymentType,
              paymentMethod: item.row.paymentMethod,
            },
          })
        }
        const incidentData = {
            paymentId: item.row.id,
            dedupeKey: `${kind}:${item.row.id}`,
            environment: item.row.providerEnvironment,
            kind,
            status: item.classification === 'reissue' ? 'resolved' : 'manual_review',
            resolvedAt: item.classification === 'reissue' ? new Date() : null,
            payload: { classification: item.classification },
        }
        await tx.paymentProviderIncident.upsert({
          where: { dedupeKey: incidentData.dedupeKey },
          update: {},
          create: incidentData,
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
