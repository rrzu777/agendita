import { getOptionalEnvBoolean } from '@/lib/env'

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export type OwnerAnalyticsOperationsConfig = {
  monitorEnabled: boolean
  alertsEnabled: boolean
  alertEmails: string[]
}

function readAlertEmails(): string[] {
  const raw = process.env.OWNER_ANALYTICS_ALERT_EMAILS?.trim() ?? ''
  if (!raw) return []
  const emails = [...new Set(raw.split(',').map((value) => value.trim()).filter(Boolean))]
  if (emails.some((email) => email.length > 254 || !emailPattern.test(email))) {
    throw new Error('Invalid OWNER_ANALYTICS_ALERT_EMAILS')
  }
  return emails
}

export function getOwnerAnalyticsOperationsConfig(): OwnerAnalyticsOperationsConfig {
  const monitorEnabled = getOptionalEnvBoolean('OWNER_ANALYTICS_OPERATIONAL_MONITOR_ENABLED') ?? false
  const alertsEnabled = getOptionalEnvBoolean('OWNER_ANALYTICS_ALERTS_ENABLED') ?? false
  const alertEmails = readAlertEmails()
  if (alertsEnabled && alertEmails.length === 0) {
    throw new Error('OWNER_ANALYTICS_ALERT_EMAILS is required when alerts are enabled')
  }
  return { monitorEnabled, alertsEnabled, alertEmails }
}
