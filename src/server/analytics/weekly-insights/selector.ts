import 'server-only'
import { prisma } from '@/lib/db'
import { getLocalDateStr, getLocalTimeStr } from '@/lib/availability/timezone'
import { addAnalyticsDays } from '@/server/analytics/reports'
import { getOwnerAnalyticsInsightsConfig } from '@/lib/analytics/weekly-insights-config'

export type WeeklyCandidate = {
  businessId: string
  weekStart: Date
  weekEnd: Date
  businessTimeZone: string
  sourceConsentVersion: number
  sourceExpiresAt: Date
}

function dateValue(value: string): Date { return new Date(`${value}T00:00:00.000Z`) }
function localWeekStart(localDate: string): string {
  const day = new Date(`${localDate}T00:00:00.000Z`).getUTCDay()
  const daysSinceMonday = day === 0 ? 6 : day - 1
  return addAnalyticsDays(localDate, -daysSinceMonday)
}

function decodeCursor(cursor: string | null): { businessId: string; weekStart: string } | null {
  if (!cursor) return null
  if (cursor.length > 512) throw new Error('Invalid weekly insights cursor')
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString())
    if (!parsed || typeof parsed.businessId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(parsed.businessId) || typeof parsed.weekStart !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(parsed.weekStart)) throw new Error()
    return parsed
  } catch { throw new Error('Invalid weekly insights cursor') }
}

export function encodeWeeklyInsightsCursor(candidate: Pick<WeeklyCandidate, 'businessId' | 'weekStart'>): string {
  return Buffer.from(JSON.stringify({ businessId: candidate.businessId, weekStart: candidate.weekStart.toISOString().slice(0, 10) })).toString('base64url')
}

/** Selects at most the two most recent completed local weeks per business. */
export async function selectWeeklyInsightCandidates(input: { now: Date; cursor: string | null; limit: number }): Promise<{ candidates: WeeklyCandidate[]; nextCursor: string | null }> {
  const config = getOwnerAnalyticsInsightsConfig()
  if (!config.enabled) return { candidates: [], nextCursor: null }
  if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 20) throw new Error('Invalid weekly insights limit')
  const cursor = decodeCursor(input.cursor)
  const businesses = await prisma.business.findMany({ where: { id: { in: config.businessIds }, isActive: true }, select: { id: true, timezone: true }, orderBy: { id: 'asc' }, take: 100 })
  const result: WeeklyCandidate[] = []
  for (const business of businesses) {
    const localToday = getLocalDateStr(input.now, business.timezone)
    // A Wednesday 09:00 local cut avoids publishing a week while late events
    // from Monday/Tuesday are still within the normal reconciliation window.
    const localDay = new Date(`${localToday}T00:00:00.000Z`).getUTCDay()
    if (localDay < 3 || (localDay === 3 && getLocalTimeStr(input.now, business.timezone) < '09:00')) continue
    const currentWeek = localWeekStart(localToday)
    for (let offset = 1; offset <= 2; offset += 1) {
      const weekStart = addAnalyticsDays(currentWeek, -7 * offset)
      if (cursor && (business.id < cursor.businessId || (business.id === cursor.businessId && weekStart <= cursor.weekStart))) continue
      const weekEnd = addAnalyticsDays(weekStart, 7)
      const rows = await prisma.analyticsDailyMetric.findMany({
        where: { businessId: business.id, cohortLocalDate: { gte: dateValue(weekStart), lt: dateValue(weekEnd) }, metricKey: '__publication__', state: 'closed', coverage: 'complete', retentionExpiresAt: { gt: input.now } },
        select: { cohortLocalDate: true, businessTimeZone: true, definitionVersion: true, consentVersion: true, revision: true, retentionExpiresAt: true },
        orderBy: [{ cohortLocalDate: 'asc' }, { id: 'asc' }],
        take: 100,
      })
      const days = new Map<string, typeof rows>()
      for (const row of rows) { const day = row.cohortLocalDate.toISOString().slice(0, 10); const list = days.get(day) ?? []; list.push(row); days.set(day, list) }
      const sourceRows = [] as typeof rows
      let valid = true
      for (let day = weekStart; day < weekEnd; day = addAnalyticsDays(day, 1)) {
        const markers = days.get(day) ?? []
        const groups = new Map<string, typeof markers>()
        for (const marker of markers) {
          const key = `${marker.businessTimeZone}|${marker.definitionVersion}|${marker.consentVersion}|${marker.revision}`
          const group = groups.get(key) ?? []; group.push(marker); groups.set(key, group)
        }
        const complete = [...groups.values()].find(group => group.length === 3)
        if (!complete) { valid = false; break }
        sourceRows.push(...complete)
      }
      if (!valid || sourceRows.length !== 21) continue
      const consentVersions = new Set(sourceRows.map(row => row.consentVersion))
      const timezones = new Set(sourceRows.map(row => row.businessTimeZone))
      const definitions = new Set(sourceRows.map(row => row.definitionVersion))
      if (consentVersions.size !== 1 || timezones.size !== 1 || definitions.size !== 1 || !consentVersions.has(1) && !consentVersions.has(2)) continue
      result.push({ businessId: business.id, weekStart: dateValue(weekStart), weekEnd: dateValue(weekEnd), businessTimeZone: business.timezone, sourceConsentVersion: sourceRows[0].consentVersion, sourceExpiresAt: new Date(Math.min(...sourceRows.map(row => row.retentionExpiresAt.getTime()))) })
    }
  }
  result.sort((a, b) => a.businessId.localeCompare(b.businessId) || a.weekStart.getTime() - b.weekStart.getTime())
  const page = result.slice(0, input.limit)
  return { candidates: page, nextCursor: result.length > page.length ? encodeWeeklyInsightsCursor(page.at(-1)!) : null }
}
