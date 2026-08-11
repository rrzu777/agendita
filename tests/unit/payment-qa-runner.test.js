import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import manifest from '../../scripts/payment-qa-manifest.cjs'

describe('offline Mercado Pago QA manifest', () => {
  it('maps every required financial scenario to existing tests', () => {
    expect(Object.keys(manifest.scenarios)).toEqual([
      'monthly.signed_webhook_duplicate',
      'monthly.callback_non_authoritative',
      'monthly.reconciliation',
      'monthly.trial_reminders_exemption_grace_enforcement_cancel',
      'tenant.oauth_environment_refresh',
      'tenant.booking_exactly_once',
      'tenant.package_exactly_once',
    ])

    for (const files of Object.values(manifest.scenarios)) {
      expect(files.length).toBeGreaterThan(0)
      expect(files.every(existsSync)).toBe(true)
    }
  })

  it('keeps local and PostgreSQL suites explicit and non-overlapping', () => {
    const local = new Set([...manifest.monthlyLocal, ...manifest.tenantLocal])
    expect(manifest.postgres.every((file) => !local.has(file))).toBe(true)
    expect(manifest.postgres.every((file) => file.includes('integration'))).toBe(true)
  })
})
