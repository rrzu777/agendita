// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { deriveOperationalSignals } from '@/server/analytics/operations/incidents'

const now = new Date('2026-09-05T12:00:00.000Z')
const heartbeat = {
  lastStartedAt: new Date('2026-09-05T11:55:00.000Z'),
  lastProgressAt: new Date('2026-09-05T11:55:00.000Z'),
  lastSuccessAt: new Date('2026-09-05T11:55:00.000Z'),
  lastStatus: 'succeeded' as const,
  consecutiveFailures: 0,
  consecutiveSuccesses: 2,
  leaseExpiresAt: null,
}

describe('owner analytics operational thresholds', () => {
  it('opens heartbeat warning at 2h15 and critical at 4h', () => {
    const warning = deriveOperationalSignals({ heartbeat: { ...heartbeat, lastSuccessAt: new Date('2026-09-05T09:45:00.000Z') }, backlog: { overdueMs: 0, dangerous: false, beyondTolerance: false, hasExpired: false }, now })
    expect(warning).toContainEqual(expect.objectContaining({ incidentType: 'heartbeat_stale', severity: 'warning' }))
    const critical = deriveOperationalSignals({ heartbeat: { ...heartbeat, lastSuccessAt: new Date('2026-09-05T08:00:00.000Z') }, backlog: { overdueMs: 0, dangerous: false, beyondTolerance: false, hasExpired: false }, now })
    expect(critical).toContainEqual(expect.objectContaining({ incidentType: 'heartbeat_stale', severity: 'critical' }))
  })

  it('opens maintenance failure severities at two and four runs', () => {
    const warning = deriveOperationalSignals({ heartbeat: { ...heartbeat, consecutiveFailures: 2 }, backlog: { overdueMs: 0, dangerous: false, beyondTolerance: false, hasExpired: false }, now })
    expect(warning).toContainEqual(expect.objectContaining({ incidentType: 'maintenance_failures', severity: 'warning' }))
    const critical = deriveOperationalSignals({ heartbeat: { ...heartbeat, consecutiveFailures: 4 }, backlog: { overdueMs: 0, dangerous: false, beyondTolerance: false, hasExpired: false }, now })
    expect(critical).toContainEqual(expect.objectContaining({ incidentType: 'maintenance_failures', severity: 'critical' }))
  })

  it('does not alert transient retention backlog, then escalates at 12h and 24h', () => {
    const transient = deriveOperationalSignals({ heartbeat, backlog: { overdueMs: 90 * 60 * 1000, dangerous: false, beyondTolerance: false, hasExpired: true }, now })
    expect(transient.some((signal) => signal.incidentType === 'retention_backlog')).toBe(false)
    const warning = deriveOperationalSignals({ heartbeat, backlog: { overdueMs: 3 * 60 * 60 * 1000, dangerous: false, beyondTolerance: false, hasExpired: true }, now })
    expect(warning).toContainEqual(expect.objectContaining({ incidentType: 'retention_backlog', severity: 'warning' }))
    const critical = deriveOperationalSignals({ heartbeat, backlog: { overdueMs: 12 * 60 * 60 * 1000, dangerous: true, beyondTolerance: false, hasExpired: true }, now })
    expect(critical).toContainEqual(expect.objectContaining({ incidentType: 'retention_backlog', severity: 'critical' }))
    const beyond = deriveOperationalSignals({ heartbeat, backlog: { overdueMs: 24 * 60 * 60 * 1000, dangerous: true, beyondTolerance: true, hasExpired: true }, now })
    expect(beyond).toContainEqual(expect.objectContaining({ incidentType: 'retention_backlog', beyondTolerance: true }))
  })
})
