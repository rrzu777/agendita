import { getOptionalEnv, getOptionalEnvBoolean } from '@/lib/env'

const MODEL_ALLOWLIST = ['gpt-5.6-luna'] as const

export type OwnerAnalyticsInsightsConfig = {
  enabled: boolean
  privacyApproved: boolean
  businessIds: string[]
  model: (typeof MODEL_ALLOWLIST)[number]
  weeklyCallBudget: number
  weeklyTokenBudget: number
  maxProviderCallsPerReport: 2
  maxOutputTokens: 700
  minMatureAttempts: 20
}

function positiveInteger(key: string, value: string | undefined): number {
  if (!value || !/^[1-9]\d*$/.test(value)) throw new Error(`${key} must be a positive integer`)
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed)) throw new Error(`${key} is too large`)
  return parsed
}

function businessIds(): string[] {
  const raw = getOptionalEnv('OWNER_ANALYTICS_INSIGHTS_BUSINESS_IDS') ?? ''
  const values = [...new Set(raw.split(',').map(value => value.trim()).filter(Boolean))]
  if (values.some(value => value.length > 128 || !/^[a-zA-Z0-9_-]+$/.test(value))) throw new Error('Invalid OWNER_ANALYTICS_INSIGHTS_BUSINESS_IDS')
  return values
}

export function getOwnerAnalyticsInsightsConfig(): OwnerAnalyticsInsightsConfig {
  const enabled = getOptionalEnvBoolean('OWNER_ANALYTICS_INSIGHTS_ENABLED') ?? false
  const privacyApproved = getOptionalEnvBoolean('OWNER_ANALYTICS_INSIGHTS_PRIVACY_APPROVED') ?? false
  const ids = businessIds()
  const rawModel = getOptionalEnv('OWNER_ANALYTICS_INSIGHTS_MODEL') ?? 'gpt-5.6-luna'
  if (!MODEL_ALLOWLIST.includes(rawModel as (typeof MODEL_ALLOWLIST)[number])) throw new Error('Invalid OWNER_ANALYTICS_INSIGHTS_MODEL')
  if (enabled && !privacyApproved) throw new Error('OWNER_ANALYTICS_INSIGHTS_PRIVACY_APPROVED is required when insights are enabled')
  if (enabled && ids.length === 0) throw new Error('OWNER_ANALYTICS_INSIGHTS_BUSINESS_IDS is required when insights are enabled')
  const weeklyCallBudget = enabled ? positiveInteger('OWNER_ANALYTICS_INSIGHTS_WEEKLY_CALL_BUDGET', getOptionalEnv('OWNER_ANALYTICS_INSIGHTS_WEEKLY_CALL_BUDGET')) : 0
  const weeklyTokenBudget = enabled ? positiveInteger('OWNER_ANALYTICS_INSIGHTS_WEEKLY_TOKEN_BUDGET', getOptionalEnv('OWNER_ANALYTICS_INSIGHTS_WEEKLY_TOKEN_BUDGET')) : 0
  return { enabled, privacyApproved, businessIds: ids, model: rawModel as (typeof MODEL_ALLOWLIST)[number], weeklyCallBudget, weeklyTokenBudget, maxProviderCallsPerReport: 2, maxOutputTokens: 700, minMatureAttempts: 20 }
}
