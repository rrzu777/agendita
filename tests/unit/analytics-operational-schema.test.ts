// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getOwnerAnalyticsOperationsConfig } from '@/lib/analytics/operations/config'

describe('owner analytics operations configuration', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('is disabled and has no recipients by default', () => {
    expect(getOwnerAnalyticsOperationsConfig()).toEqual({
      monitorEnabled: false,
      alertsEnabled: false,
      alertEmails: [],
    })
  })

  it('parses strict flags and normalized alert emails', () => {
    vi.stubEnv('OWNER_ANALYTICS_OPERATIONAL_MONITOR_ENABLED', 'true')
    vi.stubEnv('OWNER_ANALYTICS_ALERTS_ENABLED', 'true')
    vi.stubEnv('OWNER_ANALYTICS_ALERT_EMAILS', ' ops@example.com,alerts@example.com ')

    expect(getOwnerAnalyticsOperationsConfig()).toEqual({
      monitorEnabled: true,
      alertsEnabled: true,
      alertEmails: ['ops@example.com', 'alerts@example.com'],
    })
  })

  it('fails closed when alerts are enabled without recipients', () => {
    vi.stubEnv('OWNER_ANALYTICS_ALERTS_ENABLED', 'true')
    expect(() => getOwnerAnalyticsOperationsConfig()).toThrow('OWNER_ANALYTICS_ALERT_EMAILS')
  })

  it('rejects malformed flags and recipients only when the feature is enabled', () => {
    vi.stubEnv('OWNER_ANALYTICS_OPERATIONAL_MONITOR_ENABLED', 'yes')
    expect(() => getOwnerAnalyticsOperationsConfig()).toThrow('OWNER_ANALYTICS_OPERATIONAL_MONITOR_ENABLED')

    vi.stubEnv('OWNER_ANALYTICS_OPERATIONAL_MONITOR_ENABLED', 'false')
    vi.stubEnv('OWNER_ANALYTICS_ALERT_EMAILS', 'not an email')
    expect(getOwnerAnalyticsOperationsConfig()).toMatchObject({ alertsEnabled: false, alertEmails: [] })

    vi.stubEnv('OWNER_ANALYTICS_ALERTS_ENABLED', 'true')
    expect(() => getOwnerAnalyticsOperationsConfig()).toThrow('OWNER_ANALYTICS_ALERT_EMAILS')
  })
})
