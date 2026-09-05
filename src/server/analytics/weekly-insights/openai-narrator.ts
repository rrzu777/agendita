import 'server-only'
import OpenAI from 'openai'
import { zodTextFormat } from 'openai/helpers/zod'
import { weeklyNarrativeSchema, validateWeeklyNarrative, type WeeklyNarrative } from './narrative-schema'
import type { CanonicalWeeklyFacts } from './facts'

const ALLOWED_MODEL = 'gpt-5.6-luna'

export type NarrativeResult =
  | { status: 'succeeded'; narrative: WeeklyNarrative; providerRequestId: string | null; outputTokens: number | null }
  | { status: 'failed'; errorCode: 'provider_not_configured' | 'provider_timeout' | 'rate_limited' | 'provider_5xx' | 'provider_rejected' | 'schema_invalid' | 'refused' | 'config_invalid'; retryable: boolean }

function mapProviderError(error: unknown): Extract<NarrativeResult, { status: 'failed' }> {
  if (error instanceof OpenAI.APIConnectionTimeoutError) return { status: 'failed', errorCode: 'provider_timeout', retryable: true }
  if (error instanceof OpenAI.APIError) {
    if (error.status === 429) return { status: 'failed', errorCode: 'rate_limited', retryable: true }
    if (typeof error.status === 'number' && error.status >= 500) return { status: 'failed', errorCode: 'provider_5xx', retryable: true }
    if (error.status === 401 || error.status === 403) return { status: 'failed', errorCode: 'provider_rejected', retryable: false }
  }
  return { status: 'failed', errorCode: 'provider_rejected', retryable: false }
}

export async function narrateWeeklyFacts(input: { facts: CanonicalWeeklyFacts; model: string; now: Date }): Promise<NarrativeResult> {
  if (input.model !== ALLOWED_MODEL) return { status: 'failed', errorCode: 'config_invalid', retryable: false }
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) return { status: 'failed', errorCode: 'provider_not_configured', retryable: false }
  const factIds = new Set([...input.facts.signals.map(signal => signal.factId), ...input.facts.services.map(service => service.factId)])
  const actionIds = new Set([...input.facts.signals.map(signal => signal.actionId), ...input.facts.services.map(service => service.actionId)])
  const promptFacts = { ...input.facts, businessId: undefined }
  try {
    const client = new OpenAI({ apiKey, maxRetries: 0, timeout: 15_000 })
    const response = await client.responses.create({
      model: input.model,
      store: false,
      reasoning: { effort: 'none' },
      max_output_tokens: 700,
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
    return mapProviderError(error)
  }
}
