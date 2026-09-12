// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getOwnerAnalyticsInsightsConfig } from '@/lib/analytics/weekly-insights-config'

describe('weekly owner insights schema/config contract', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('is disabled with no provider budget by default', () => {
    expect(getOwnerAnalyticsInsightsConfig()).toEqual(expect.objectContaining({
      enabled: false,
      privacyApproved: false,
      businessIds: [],
      model: 'gpt-5.6-luna',
      weeklyCallBudget: 0,
      weeklyTokenBudget: 0,
      maxProviderCallsPerReport: 2,
      maxOutputTokens: 700,
      minMatureAttempts: 20,
    }))
  })

  it('requires privacy, business allowlist and positive budgets before enabling', () => {
    vi.stubEnv('OWNER_ANALYTICS_INSIGHTS_ENABLED', 'true')
    vi.stubEnv('OWNER_ANALYTICS_INSIGHTS_PRIVACY_APPROVED', 'true')
    vi.stubEnv('OWNER_ANALYTICS_INSIGHTS_BUSINESS_IDS', 'biz-a,biz-b,biz-a')
    vi.stubEnv('OWNER_ANALYTICS_INSIGHTS_WEEKLY_CALL_BUDGET', '12')
    vi.stubEnv('OWNER_ANALYTICS_INSIGHTS_WEEKLY_TOKEN_BUDGET', '8400')
    expect(getOwnerAnalyticsInsightsConfig()).toMatchObject({ enabled: true, businessIds: ['biz-a', 'biz-b'], weeklyCallBudget: 12, weeklyTokenBudget: 8400 })
  })

  it('rejects an enabled config that is missing a gate or uses an unallowlisted model', () => {
    vi.stubEnv('OWNER_ANALYTICS_INSIGHTS_ENABLED', 'true')
    expect(() => getOwnerAnalyticsInsightsConfig()).toThrow('PRIVACY_APPROVED')
    vi.stubEnv('OWNER_ANALYTICS_INSIGHTS_PRIVACY_APPROVED', 'true')
    vi.stubEnv('OWNER_ANALYTICS_INSIGHTS_BUSINESS_IDS', 'biz-a')
    vi.stubEnv('OWNER_ANALYTICS_INSIGHTS_WEEKLY_CALL_BUDGET', '1')
    vi.stubEnv('OWNER_ANALYTICS_INSIGHTS_WEEKLY_TOKEN_BUDGET', '700')
    vi.stubEnv('OWNER_ANALYTICS_INSIGHTS_MODEL', 'gpt-5.5')
    expect(() => getOwnerAnalyticsInsightsConfig()).toThrow('MODEL')
  })

  it('rejects malformed strict booleans and business identifiers', () => {
    vi.stubEnv('OWNER_ANALYTICS_INSIGHTS_ENABLED', 'yes')
    expect(() => getOwnerAnalyticsInsightsConfig()).toThrow('INSIGHTS_ENABLED')
    vi.stubEnv('OWNER_ANALYTICS_INSIGHTS_ENABLED', 'false')
    vi.stubEnv('OWNER_ANALYTICS_INSIGHTS_BUSINESS_IDS', 'biz/with/path')
    expect(() => getOwnerAnalyticsInsightsConfig()).toThrow('BUSINESS_IDS')
  })
})
