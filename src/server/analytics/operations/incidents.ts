import 'server-only'
import { createHash } from 'node:crypto'
import { prisma } from '@/lib/db'
import { analyticsRetentionStatus } from '@/server/analytics/maintenance'
import { getOwnerAnalyticsOperationsConfig, type OwnerAnalyticsOperationsConfig } from '@/lib/analytics/operations/config'

const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS
const ALERT_REMINDER_MS = 12 * HOUR_MS
const INCIDENT_RETENTION_MS = 90 * DAY_MS

type HeartbeatSnapshot = {
  lastStartedAt: Date | null
  lastProgressAt: Date | null
  lastSuccessAt: Date | null
  lastStatus: 'running' | 'succeeded' | 'partial' | 'failed' | null
  consecutiveFailures: number
  consecutiveSuccesses: number
  leaseExpiresAt: Date | null
}

export type OperationalSignal = {
  incidentType: 'heartbeat_stale' | 'maintenance_failures' | 'retention_backlog'
  severity: 'warning' | 'critical'
  details: Record<string, number | boolean | string>
  beyondTolerance: boolean
}

export function deriveOperationalSignals(input: {
  heartbeat: HeartbeatSnapshot | null
  backlog: { overdueMs: number; dangerous: boolean; beyondTolerance: boolean; hasExpired: boolean }
  now: Date
}): OperationalSignal[] {
  if (!input.heartbeat) return []
  const signals: OperationalSignal[] = []
  const anchor = input.heartbeat.lastStatus === 'running'
    ? input.heartbeat.lastProgressAt ?? input.heartbeat.lastStartedAt
    : input.heartbeat.lastSuccessAt ?? input.heartbeat.lastStartedAt
  if (anchor) {
    const staleMs = Math.max(0, input.now.getTime() - anchor.getTime())
    if (staleMs >= 4 * HOUR_MS) signals.push({ incidentType: 'heartbeat_stale', severity: 'critical', details: { staleMs, lastStatus: input.heartbeat.lastStatus ?? 'unknown' }, beyondTolerance: false })
    else if (staleMs >= 2 * HOUR_MS + 15 * 60 * 1000) signals.push({ incidentType: 'heartbeat_stale', severity: 'warning', details: { staleMs, lastStatus: input.heartbeat.lastStatus ?? 'unknown' }, beyondTolerance: false })
  }
  if (input.heartbeat.consecutiveFailures >= 4) signals.push({ incidentType: 'maintenance_failures', severity: 'critical', details: { consecutiveFailures: input.heartbeat.consecutiveFailures }, beyondTolerance: false })
  else if (input.heartbeat.consecutiveFailures >= 2) signals.push({ incidentType: 'maintenance_failures', severity: 'warning', details: { consecutiveFailures: input.heartbeat.consecutiveFailures }, beyondTolerance: false })
  if (input.backlog.beyondTolerance) signals.push({ incidentType: 'retention_backlog', severity: 'critical', details: { overdueMs: input.backlog.overdueMs, dangerous: input.backlog.dangerous, beyondTolerance: true }, beyondTolerance: true })
  else if (input.backlog.overdueMs >= 2 * HOUR_MS) signals.push({ incidentType: 'retention_backlog', severity: input.backlog.dangerous ? 'critical' : 'warning', details: { overdueMs: input.backlog.overdueMs, dangerous: input.backlog.dangerous, beyondTolerance: false }, beyondTolerance: false })
  return signals
}

function severityRank(value: 'warning' | 'critical'): number { return value === 'critical' ? 2 : 1 }
function activeKey(signal: OperationalSignal): string { return `owner_analytics_maintenance:${signal.incidentType}` }
function notificationKind(signal: OperationalSignal, previous: { lastNotifiedSeverity: string | null; lastNotificationAt: Date | null; lastNotificationCode: string | null } | null, now: Date): 'alert_open' | 'alert_escalation' | 'alert_reminder' | 'alert_beyond_tolerance' | null {
  if (!previous || !previous.lastNotifiedSeverity) return 'alert_open'
  if (severityRank(signal.severity) > severityRank(previous.lastNotifiedSeverity as 'warning' | 'critical')) return 'alert_escalation'
  if (signal.beyondTolerance && previous.lastNotificationCode !== 'beyond_tolerance') return 'alert_beyond_tolerance'
  if (previous.lastNotificationAt && now.getTime() - previous.lastNotificationAt.getTime() >= ALERT_REMINDER_MS) return 'alert_reminder'
  return null
}

function alertText(signal: OperationalSignal, kind: string): { subject: string; html: string; text: string } {
  const title = kind === 'alert_escalation' ? 'Alerta operacional escalada' : kind === 'alert_resolved' ? 'Alerta operacional resuelta' : 'Alerta operacional de métricas'
  const label = signal.incidentType === 'heartbeat_stale' ? 'mantenimiento sin éxito reciente' : signal.incidentType === 'maintenance_failures' ? 'fallas consecutivas de mantenimiento' : 'atraso de retención'
  const details = Object.entries(signal.details).map(([key, value]) => `${key}: ${String(value).replace(/[<>]/g, '')}`).join(', ')
  return { subject: `[Agendita] ${title}`, html: `<p>${title}: ${label}.</p><p>${details}</p>`, text: `${title}: ${label}. ${details}` }
}

async function createDelivery(tx: any, input: { incidentId: string; sequence: number; kind: 'alert_open' | 'alert_escalation' | 'alert_reminder' | 'alert_beyond_tolerance' | 'alert_resolved'; signal: OperationalSignal; config: OwnerAnalyticsOperationsConfig; now: Date }): Promise<void> {
  if (!input.config.alertsEnabled || input.config.alertEmails.length === 0) return
  const content = alertText(input.signal, input.kind)
  const dedupeKey = `analytics-incident:${input.incidentId}:${input.kind}:${input.sequence}`
  await tx.analyticsEmailDelivery.create({
    data: {
      incidentId: input.incidentId,
      dedupeKey,
      notificationKind: input.kind,
      payloadHash: createHash('sha256').update(JSON.stringify({ to: input.config.alertEmails, ...content })).digest('hex'),
      recipients: input.config.alertEmails,
      subject: content.subject,
      htmlBody: content.html,
      textBody: content.text,
      retentionExpiresAt: new Date(input.now.getTime() + INCIDENT_RETENTION_MS),
    },
  })
}

async function reconcileSignal(signal: OperationalSignal, now: Date, config: OwnerAnalyticsOperationsConfig): Promise<void> {
  const key = activeKey(signal)
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`
    const previous = await tx.analyticsOperationalIncident.findUnique({ where: { activeKey: key } })
    const kind = config.alertsEnabled ? notificationKind(signal, previous, now) : null
    const sequence = (previous?.notificationAttempts ?? 0) + (kind ? 1 : 0)
    const incident = previous
      ? await tx.analyticsOperationalIncident.update({
          where: { id: previous.id },
          data: { severity: signal.severity, lastObservedAt: now, details: signal.details, ...(kind ? { lastNotifiedSeverity: signal.severity, lastNotificationAt: now, lastNotificationStatus: 'pending', lastNotificationCode: signal.beyondTolerance ? 'beyond_tolerance' : kind } : {}) },
        })
      : await tx.analyticsOperationalIncident.create({
          data: { activeKey: key, incidentType: signal.incidentType, severity: signal.severity, openedAt: now, lastObservedAt: now, details: signal.details },
        })
    if (kind) {
      await createDelivery(tx, { incidentId: incident.id, sequence, kind, signal, config, now })
      await tx.analyticsOperationalIncident.update({ where: { id: incident.id }, data: { notificationAttempts: { increment: 1 } } })
    }
  })
}

async function resolveHealthyIncident(type: OperationalSignal['incidentType'], now: Date, config: OwnerAnalyticsOperationsConfig, ready: boolean): Promise<void> {
  if (!ready) return
  const key = `owner_analytics_maintenance:${type}`
  await prisma.$transaction(async (tx) => {
    const incident = await tx.analyticsOperationalIncident.findUnique({ where: { activeKey: key } })
    if (!incident) return
    const shouldNotify = config.alertsEnabled && incident.lastNotificationStatus === 'sent'
    await tx.analyticsOperationalIncident.update({ where: { id: incident.id }, data: { activeKey: null, resolvedAt: now, healthySince: now, retentionExpiresAt: new Date(now.getTime() + INCIDENT_RETENTION_MS) } })
    if (shouldNotify) {
      const signal: OperationalSignal = { incidentType: type, severity: incident.severity, details: { resolvedAt: now.toISOString() }, beyondTolerance: false }
      const content = alertText(signal, 'alert_resolved')
      await tx.analyticsEmailDelivery.create({ data: { incidentId: incident.id, dedupeKey: `analytics-incident:${incident.id}:alert_resolved:1`, notificationKind: 'alert_resolved', payloadHash: createHash('sha256').update(JSON.stringify({ to: config.alertEmails, ...content })).digest('hex'), recipients: config.alertEmails, subject: content.subject, htmlBody: content.html, textBody: content.text, retentionExpiresAt: new Date(now.getTime() + INCIDENT_RETENTION_MS) } })
    }
  })
}

export async function evaluateOwnerAnalyticsOperations(now = new Date()): Promise<{ state: 'healthy' | 'warning' | 'critical' | 'not_initialized' | 'not_enabled'; incidents: OperationalSignal[]; backlog: { overdueMs: number; dangerous: boolean; beyondTolerance: boolean; hasExpired: boolean } }> {
  const config = getOwnerAnalyticsOperationsConfig()
  if (!config.monitorEnabled) return { state: 'not_enabled', incidents: [], backlog: { overdueMs: 0, dangerous: false, beyondTolerance: false, hasExpired: false } }
  const [heartbeat, backlog] = await Promise.all([
    prisma.analyticsJobHeartbeat.findUnique({ where: { jobKey: 'owner_analytics_maintenance' }, select: { lastStartedAt: true, lastProgressAt: true, lastSuccessAt: true, lastStatus: true, consecutiveFailures: true, consecutiveSuccesses: true, leaseExpiresAt: true } }),
    analyticsRetentionStatus(now),
  ])
  if (!heartbeat) return { state: 'not_initialized', incidents: [], backlog }
  const signals = deriveOperationalSignals({ heartbeat: heartbeat as HeartbeatSnapshot, backlog, now })
  for (const signal of signals) await reconcileSignal(signal, now, config)
  const signalTypes = new Set(signals.map((signal) => signal.incidentType))
  for (const type of ['heartbeat_stale', 'maintenance_failures', 'retention_backlog'] as const) {
    if (!signalTypes.has(type)) {
      const ready = type === 'retention_backlog'
        ? !backlog.hasExpired
        : heartbeat.consecutiveSuccesses >= 2
      await resolveHealthyIncident(type, now, config, ready)
    }
  }
  const state = signals.some((signal) => signal.severity === 'critical') ? 'critical' : signals.length ? 'warning' : 'healthy'
  return { state, incidents: signals, backlog }
}
