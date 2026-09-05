import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { prisma } from '../helpers/analytics-report-db'
import { evaluateOwnerAnalyticsOperations } from '@/server/analytics/operations/incidents'

for (const key of ['DATABASE_URL', 'DIRECT_URL'] as const) {
  const raw = process.env[key]
  if (!raw) throw new Error(`${key} must be explicitly set for analytics tests`)
  const url = new URL(raw)
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.pathname !== '/agendita_owner_analytics_test' || process.env.NODE_ENV === 'production') throw new Error('Refusing non-exclusive analytics test database')
}

const now = new Date('2026-09-05T12:00:00.000Z')

describe('durable owner analytics incidents', () => {
  beforeEach(async () => {
    vi.stubEnv('OWNER_ANALYTICS_OPERATIONAL_MONITOR_ENABLED', 'true')
    vi.stubEnv('OWNER_ANALYTICS_ALERTS_ENABLED', 'false')
    await prisma.analyticsEmailDelivery.deleteMany()
    await prisma.analyticsOperationalIncident.deleteMany()
    await prisma.analyticsJobHeartbeat.deleteMany()
  })
  afterEach(() => vi.unstubAllEnvs())
  afterAll(async () => { await prisma.analyticsEmailDelivery.deleteMany(); await prisma.analyticsOperationalIncident.deleteMany(); await prisma.analyticsJobHeartbeat.deleteMany(); await prisma.$disconnect() })

  it('creates one stale incident under concurrent evaluators and resolves it after two successes', async () => {
    await prisma.analyticsJobHeartbeat.create({ data: { jobKey: 'owner_analytics_maintenance', lastStartedAt: new Date('2026-09-05T07:00:00.000Z'), lastSuccessAt: new Date('2026-09-05T07:00:00.000Z'), lastProgressAt: new Date('2026-09-05T07:00:00.000Z'), lastStatus: 'failed', consecutiveFailures: 2, consecutiveSuccesses: 0 } })
    const results = await Promise.all([evaluateOwnerAnalyticsOperations(now), evaluateOwnerAnalyticsOperations(now)])
    expect(results.every(result => result.state === 'critical' || result.state === 'warning')).toBe(true)
    expect(await prisma.analyticsOperationalIncident.count({ where: { activeKey: { not: null } } })).toBe(2)

    await prisma.analyticsJobHeartbeat.update({ where: { jobKey: 'owner_analytics_maintenance' }, data: { lastStatus: 'succeeded', lastSuccessAt: now, lastProgressAt: now, consecutiveFailures: 0, consecutiveSuccesses: 2 } })
    await evaluateOwnerAnalyticsOperations(new Date(now.getTime() + 1000))
    expect(await prisma.analyticsOperationalIncident.count({ where: { activeKey: { not: null } } })).toBe(0)
  })
})
