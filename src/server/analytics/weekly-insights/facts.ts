import 'server-only'
import { createHash } from 'node:crypto'
import { prisma } from '@/lib/db'
import { summarizeAnalyticsCells } from '@/server/analytics/reports'
import { getOwnerAnalyticsInsightsConfig } from '@/lib/analytics/weekly-insights-config'
import type { DailyMetricCell, Population } from '@/lib/analytics/report-types'
import { WEEKLY_ACTIONS, type WeeklyActionId } from './actions'

export type WeeklyFact = { factId: string; value: number; numerator: number; denominator: number; rate: number | null; actionId: WeeklyActionId }
export type WeeklyServiceFact = { factId: string; serviceId: string; interest: number; selected: number; conversionNumerator: number; conversionDenominator: number; conversionRate: number | null; actionId: 'review_service_interest' }
export type CanonicalWeeklyFacts = {
  version: 1
  weekStart: string
  weekEnd: string
  businessTimeZone: string
  sourceConsentVersion: 1 | 2
  matureCompleteAttempts: number
  visits: number
  conversion: { numerator: number; denominator: number; rate: number | null }
  visitToAttempt: { numerator: number; denominator: number; rate: number | null }
  signals: WeeklyFact[]
  services: WeeklyServiceFact[]
  caveats: ('limited_population' | 'coverage_complete' | 'deterministic_only')[]
}

export type WeeklyFactsResult = { status: 'insufficient_data' | 'deterministic_ready'; sourceConsentVersion: 1 | 2; facts: CanonicalWeeklyFacts | null; sourceExpiry: Date; inputHash: string; reasonCode?: 'not_enough_mature_attempts' | 'mixed_consent' | 'incomplete_source' }

function hash(value: unknown): string { return createHash('sha256').update(JSON.stringify(value)).digest('hex') }
function asCells(rows: Array<Record<string, unknown>>): DailyMetricCell[] { return rows.map(row => ({ ...row, cohortLocalDate: (row.cohortLocalDate as Date).toISOString().slice(0, 10), metricKey: row.metricKey as DailyMetricCell['metricKey'], consentVersion: (row.consentVersion as number | undefined) ?? 1 }) as DailyMetricCell) }
function findMetric(cells: DailyMetricCell[], population: Population, metricKey: DailyMetricCell['metricKey'], grain: DailyMetricCell['grain'] = 'total', dimensionKey = 'total') { return cells.filter(row => row.population === population && row.metricKey === metricKey && row.grain === grain && row.dimensionKey === dimensionKey).reduce((sum, row) => ({ numerator: sum.numerator + row.numerator, denominator: sum.denominator + row.denominator }), { numerator: 0, denominator: 0 }) }
function rate(numerator: number, denominator: number): number | null { return denominator > 0 ? numerator / denominator : null }

export async function buildWeeklyFacts(input: { businessId: string; weekStart: Date; now: Date }): Promise<WeeklyFactsResult> {
  const config = getOwnerAnalyticsInsightsConfig()
  const rows = await prisma.analyticsDailyMetric.findMany({ where: { businessId: input.businessId, cohortLocalDate: { gte: input.weekStart, lt: new Date(input.weekStart.getTime() + 7 * 24 * 60 * 60 * 1000) }, retentionExpiresAt: { gt: input.now }, state: 'closed', coverage: 'complete' }, orderBy: [{ cohortLocalDate: 'asc' }, { id: 'asc' }], take: 20000 })
  const rawCells = asCells(rows as unknown as Array<Record<string, unknown>>)
  const markerGroups = new Map<string, DailyMetricCell[]>()
  for (const row of rawCells.filter(row => row.metricKey === '__publication__')) { const key = `${row.cohortLocalDate}|${row.businessTimeZone}|${row.definitionVersion}|${row.consentVersion ?? 1}|${row.revision}`; const group = markerGroups.get(key) ?? []; group.push(row); markerGroups.set(key, group) }
  const validMarkers = [...markerGroups.values()].filter(group => group.length === 3)
  const days = new Set(validMarkers.map(group => group[0].cohortLocalDate))
  const versions = new Set(validMarkers.flatMap(group => group.map(row => row.consentVersion ?? 1)))
  const sourceExpiry = rawCells.length ? new Date(Math.min(...rawCells.map(row => row.retentionExpiresAt.getTime()))) : new Date(input.now.getTime() + 90 * 24 * 60 * 60 * 1000)
  if (days.size !== 7 || versions.size !== 1) return { status: 'insufficient_data', sourceConsentVersion: versions.has(2) ? 2 : 1, facts: null, sourceExpiry, inputHash: hash({ businessId: input.businessId, weekStart: input.weekStart.toISOString(), reason: versions.size > 1 ? 'mixed_consent' : 'incomplete_source' }), reasonCode: versions.size > 1 ? 'mixed_consent' : 'incomplete_source' }
  const selectedKeys = new Set<string>()
  const selectedDays = [...days].sort()
  const sourceVersion = [...versions][0] as 1 | 2
  let sourceTimezone: string | null = null
  let sourceDefinition: number | null = null
  for (const day of selectedDays) {
    const group = validMarkers.find(candidate => candidate[0].cohortLocalDate === day && (candidate[0].consentVersion ?? 1) === sourceVersion)
    if (!group) return { status: 'insufficient_data', sourceConsentVersion: sourceVersion, facts: null, sourceExpiry, inputHash: hash({ businessId: input.businessId, weekStart: input.weekStart.toISOString(), reason: 'incomplete_source' }), reasonCode: 'incomplete_source' }
    if (sourceTimezone === null) { sourceTimezone = group[0].businessTimeZone; sourceDefinition = group[0].definitionVersion }
    if (group[0].businessTimeZone !== sourceTimezone || group[0].definitionVersion !== sourceDefinition) return { status: 'insufficient_data', sourceConsentVersion: sourceVersion, facts: null, sourceExpiry, inputHash: hash({ businessId: input.businessId, weekStart: input.weekStart.toISOString(), reason: 'incomplete_source' }), reasonCode: 'incomplete_source' }
    selectedKeys.add(`${day}|${group[0].businessTimeZone}|${group[0].definitionVersion}|${group[0].consentVersion ?? 1}|${group[0].revision}`)
  }
  const cells = rawCells.filter(row => selectedKeys.has(`${row.cohortLocalDate}|${row.businessTimeZone}|${row.definitionVersion}|${row.consentVersion ?? 1}|${row.revision}`))
  const selectedExpiry = cells.length ? new Date(Math.min(...cells.map(row => row.retentionExpiresAt.getTime()))) : sourceExpiry
  const summary = summarizeAnalyticsCells(cells)
  const matureCompleteAttempts = summary.complete.conversion.denominator
  const canonicalBase = { version: 1 as const, weekStart: input.weekStart.toISOString().slice(0, 10), weekEnd: new Date(input.weekStart.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10), businessTimeZone: cells[0]?.businessTimeZone ?? 'UTC', sourceConsentVersion: sourceVersion, matureCompleteAttempts, visits: summary.visits, conversion: summary.complete.conversion, visitToAttempt: summary.visitToAttempt }
  const signals: WeeklyFact[] = []
  if (matureCompleteAttempts < config.minMatureAttempts) return { status: 'insufficient_data', sourceConsentVersion: canonicalBase.sourceConsentVersion, facts: null, sourceExpiry: selectedExpiry, inputHash: hash(canonicalBase), reasonCode: 'not_enough_mature_attempts' }
  if (summary.complete.conversion.rate !== null && summary.complete.conversion.rate < 0.15) signals.push({ factId: 'conversion_below_15_percent', value: summary.complete.conversion.rate, numerator: summary.complete.conversion.numerator, denominator: summary.complete.conversion.denominator, rate: summary.complete.conversion.rate, actionId: 'review_funnel_completion' })
  if (summary.complete.availabilityEmpty.denominator >= config.minMatureAttempts && summary.complete.availabilityEmpty.rate !== null && summary.complete.availabilityEmpty.rate >= 0.3) signals.push({ factId: 'availability_empty_over_30_percent', value: summary.complete.availabilityEmpty.rate, numerator: summary.complete.availabilityEmpty.numerator, denominator: summary.complete.availabilityEmpty.denominator, rate: summary.complete.availabilityEmpty.rate, actionId: 'review_availability' })
  const services: WeeklyServiceFact[] = []
  const serviceIds = [...new Set(cells.filter(row => row.grain === 'service' && row.population === 'complete_attempts').map(row => row.dimensionKey))].sort()
  for (const serviceId of serviceIds) {
    const interest = findMetric(cells, 'complete_attempts', 'service_interest', 'service', serviceId).numerator
    const selected = findMetric(cells, 'complete_attempts', 'service_selected', 'service', serviceId).numerator
    const conversion = findMetric(cells, 'complete_attempts', 'service_conversion', 'service', serviceId)
    const service = { factId: `service_${serviceId}_low_interest_to_conversion`, serviceId, interest, selected, conversionNumerator: conversion.numerator, conversionDenominator: conversion.denominator, conversionRate: rate(conversion.numerator, conversion.denominator), actionId: 'review_service_interest' as const }
    if (interest >= 5 && service.conversionRate !== null && service.conversionRate < 0.15) services.push(service)
  }
  services.sort((a, b) => a.conversionRate! - b.conversionRate! || a.serviceId.localeCompare(b.serviceId))
  const facts: CanonicalWeeklyFacts = { ...canonicalBase, signals: signals.slice(0, 3), services: services.slice(0, 3), caveats: ['coverage_complete', 'deterministic_only', ...(matureCompleteAttempts < 50 ? ['limited_population' as const] : [])] }
  return { status: 'deterministic_ready', sourceConsentVersion: facts.sourceConsentVersion, facts, sourceExpiry: selectedExpiry, inputHash: hash(facts) }
}

export function weeklyActionLabel(actionId: WeeklyActionId): string { return WEEKLY_ACTIONS[actionId].label }
