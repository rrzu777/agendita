import 'server-only'
import OpenAI from 'openai'
import { zodTextFormat } from 'openai/helpers/zod'
import { weeklyNarrativeSchema, validateWeeklyNarrative, type WeeklyNarrative } from './narrative-schema'
import type { CanonicalWeeklyFacts } from './facts'

const ALLOWED_MODEL = 'gpt-5.6-luna'

export type NarrativeResult =
  | { status: 'succeeded'; narrative: WeeklyNarrative; providerRequestId: string | null; outputTokens: number | null }
  | { status: 'failed'; errorCode: 'provider_not_configured' | 'provider_timeout' | 'rate_limited' | 'provider_5xx' | 'provider_rejected' | 'schema_invalid' | 'refused' | 'config_invalid'; retryable: boolean; retryAfterMs?: number }

function retryAfterMs(error: { headers?: Headers | null }, now: Date): number | undefined {
  const raw = error.headers?.get('retry-after')
  if (!raw) return undefined
  const seconds = Number(raw)
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(24 * 60 * 60 * 1000, Math.trunc(seconds * 1000))
  const timestamp = Date.parse(raw)
  return Number.isFinite(timestamp) ? Math.min(24 * 60 * 60 * 1000, Math.max(0, timestamp - now.getTime())) : undefined
}

function mapProviderError(error: unknown, now: Date): Extract<NarrativeResult, { status: 'failed' }> {
  if (error instanceof OpenAI.APIConnectionTimeoutError) return { status: 'failed', errorCode: 'provider_timeout', retryable: true }
  if (error instanceof OpenAI.APIError) {
    if (error.status === 429) return { status: 'failed', errorCode: 'rate_limited', retryable: true, retryAfterMs: retryAfterMs(error, now) }
    if (typeof error.status === 'number' && error.status >= 500) return { status: 'failed', errorCode: 'provider_5xx', retryable: true, retryAfterMs: retryAfterMs(error, now) }
    if (error.status === 401 || error.status === 403) return { status: 'failed', errorCode: 'provider_rejected', retryable: false }
  }
  return { status: 'failed', errorCode: 'provider_rejected', retryable: false }
}

export async function narrateWeeklyFacts(input: { facts: CanonicalWeeklyFacts; model: string; now: Date; maxOutputTokens?: number }): Promise<NarrativeResult> {
  if (input.model !== ALLOWED_MODEL) return { status: 'failed', errorCode: 'config_invalid', retryable: false }
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) return { status: 'failed', errorCode: 'provider_not_configured', retryable: false }
  const factIds = new Set([...input.facts.signals.map(signal => signal.factId), ...input.facts.services.map(service => service.factId)])
  const actionIds = new Set([...input.facts.signals.map(signal => signal.actionId), ...input.facts.services.map(service => service.actionId)])
  // Keep the provider contract deliberately smaller than the persisted
  // snapshot. Service IDs are useful for tenant-local rendering, but are not
  // needed to narrate canonical facts and could become a cross-system handle.
  const promptFacts = {
    version: input.facts.version,
    weekStart: input.facts.weekStart,
    weekEnd: input.facts.weekEnd,
    businessTimeZone: input.facts.businessTimeZone,
    sourceConsentVersion: input.facts.sourceConsentVersion,
    matureCompleteAttempts: input.facts.matureCompleteAttempts,
    visits: input.facts.visits,
    conversion: input.facts.conversion,
    visitToAttempt: input.facts.visitToAttempt,
    signals: input.facts.signals,
    services: input.facts.services.map(service => ({
      factId: service.factId,
      interest: service.interest,
      selected: service.selected,
      conversionNumerator: service.conversionNumerator,
      conversionDenominator: service.conversionDenominator,
      conversionRate: service.conversionRate,
      actionId: service.actionId,
    })),
    caveats: input.facts.caveats,
  }
  try {
    const client = new OpenAI({ apiKey, maxRetries: 0, timeout: 15_000 })
    const response = await client.responses.create({
      model: input.model,
      store: false,
      reasoning: { effort: 'none' },
      max_output_tokens: Math.max(1, Math.min(700, Math.trunc(input.maxOutputTokens ?? 700))),
      input: [
        { role: 'system', content: 'Resume sólo los hechos canónicos recibidos. No inventes causas, nombres, cifras ni acciones. Devuelve exactamente el esquema solicitado; usa factId y actionId existentes.' },
        { role: 'user', content: JSON.stringify(promptFacts) },
      ],
      text: { format: zodTextFormat(weeklyNarrativeSchema, 'weekly_owner_insight') },
    })
    if (response.status === 'incomplete') return { status: 'failed', errorCode: 'provider_rejected', retryable: true }
    const raw = response.output_text
    if (!raw) return { status: 'failed', errorCode: 'refused', retryable: false }
    let parsed: unknown
    try { parsed = JSON.parse(raw) } catch { return { status: 'failed', errorCode: 'schema_invalid', retryable: false } }
    let narrative: WeeklyNarrative
    try { narrative = validateWeeklyNarrative(parsed, factIds, actionIds) } catch { return { status: 'failed', errorCode: 'schema_invalid', retryable: false } }
    return { status: 'succeeded', narrative, providerRequestId: response.id ?? null, outputTokens: response.usage?.output_tokens ?? null }
  } catch (error) {
    return mapProviderError(error, input.now)
  }
}
