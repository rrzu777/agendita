// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'

const { clientState, MockAPIError, MockTimeoutError, MockOpenAI } = vi.hoisted(() => {
  const state = { response: null as unknown, create: vi.fn() }
  class APIError extends Error { status?: number; constructor(message: string, status?: number) { super(message); this.status = status } }
  class TimeoutError extends Error {}
  class OpenAIClient {
    static APIError = APIError
    static APIConnectionTimeoutError = TimeoutError
    responses = { create: state.create }
    constructor(public options: unknown) {}
  }
  return { clientState: state, MockAPIError: APIError, MockTimeoutError: TimeoutError, MockOpenAI: OpenAIClient }
})
vi.mock('openai', () => ({ default: MockOpenAI, APIError: MockAPIError, APIConnectionTimeoutError: MockTimeoutError }))

import { narrateWeeklyFacts } from '@/server/analytics/weekly-insights/openai-narrator'

const facts = {
  version: 1 as const, weekStart: '2026-08-24', weekEnd: '2026-08-31', businessTimeZone: 'America/Santiago', sourceConsentVersion: 2 as const,
  matureCompleteAttempts: 40, visits: 80, conversion: { numerator: 4, denominator: 40, rate: 0.1 }, visitToAttempt: { numerator: 40, denominator: 80, rate: 0.5 },
  signals: [{ factId: 'conversion_below_15_percent', value: 0.1, numerator: 4, denominator: 40, rate: 0.1, actionId: 'review_funnel_completion' as const }], services: [], caveats: ['coverage_complete' as const, 'deterministic_only' as const],
}

describe('weekly OpenAI narrator', () => {
  afterEach(() => { vi.unstubAllEnvs(); clientState.create.mockReset() })

  it('does not call the provider without an API key or with a disallowed model', async () => {
    await expect(narrateWeeklyFacts({ facts, model: 'gpt-5.6-luna', now: new Date() })).resolves.toMatchObject({ status: 'failed', errorCode: 'provider_not_configured' })
    vi.stubEnv('OPENAI_API_KEY', 'synthetic')
    await expect(narrateWeeklyFacts({ facts, model: 'gpt-5.5', now: new Date() })).resolves.toMatchObject({ status: 'failed', errorCode: 'config_invalid' })
    expect(clientState.create).not.toHaveBeenCalled()
  })

  it('uses store false, strict text format and validates returned references', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'synthetic')
    clientState.create.mockResolvedValue({ id: 'resp_1', status: 'completed', output_text: JSON.stringify({ summary: 'Revisa el embudo.', findings: [{ factId: 'conversion_below_15_percent', actionId: 'review_funnel_completion', statement: 'La conversión fue baja.' }], caveats: ['coverage_complete'] }), usage: { output_tokens: 42 } })
    const result = await narrateWeeklyFacts({ facts, model: 'gpt-5.6-luna', now: new Date() })
    expect(result).toMatchObject({ status: 'succeeded', providerRequestId: 'resp_1', outputTokens: 42 })
    expect(clientState.create).toHaveBeenCalledWith(expect.objectContaining({ store: false, max_output_tokens: 700, reasoning: { effort: 'none' }, text: { format: expect.anything() } }))
  })
})
