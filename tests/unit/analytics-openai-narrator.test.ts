// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'

const { clientState, MockAPIError, MockTimeoutError, MockOpenAI } = vi.hoisted(() => {
  const state = { response: null as unknown, create: vi.fn() }
  class APIError extends Error { status?: number; headers?: Headers; constructor(message: string, status?: number, headers?: Headers) { super(message); this.status = status; this.headers = headers } }
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
    const result = await narrateWeeklyFacts({ facts, model: 'gpt-5.6-luna', now: new Date(), maxOutputTokens: 42 })
    expect(result).toMatchObject({ status: 'succeeded', providerRequestId: 'resp_1', outputTokens: 42 })
    expect(clientState.create).toHaveBeenCalledWith(expect.objectContaining({ store: false, max_output_tokens: 42, reasoning: { effort: 'none' }, text: { format: expect.anything() } }))
  })

  it('omits tenant handles from the provider facts payload', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'synthetic')
    clientState.create.mockResolvedValue({ id: 'resp_2', status: 'completed', output_text: JSON.stringify({ summary: 'Revisa el servicio.', findings: [], caveats: ['coverage_complete'] }), usage: { output_tokens: 10 } })
    const withService = { ...facts, services: [{ factId: 'service_opaque_low_interest_to_conversion', serviceId: 'service-secret-id', interest: 10, selected: 2, conversionNumerator: 1, conversionDenominator: 10, conversionRate: 0.1, actionId: 'review_service_interest' as const }] }
    await narrateWeeklyFacts({ facts: withService, model: 'gpt-5.6-luna', now: new Date() })
    const request = clientState.create.mock.calls.at(-1)?.[0] as { input: Array<{ content: string }> }
    expect(request.input[1].content).not.toContain('service-secret-id')
    expect(request.input[1].content).toContain('service_signal_1')
    expect(request.input[1].content).not.toContain('service_opaque_low_interest_to_conversion')
  })

  it('maps a provider Retry-After header to a durable retry hint', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'synthetic')
    clientState.create.mockRejectedValue(new MockAPIError('busy', 429, new Headers({ 'retry-after': '7200' })))
    await expect(narrateWeeklyFacts({ facts, model: 'gpt-5.6-luna', now: new Date('2026-09-05T12:00:00.000Z') })).resolves.toMatchObject({ status: 'failed', errorCode: 'rate_limited', retryable: true, retryAfterMs: 7200000 })
  })
})
