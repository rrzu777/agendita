// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { configureCapture } from '../helpers/analytics-capture'
import { isPublicAnalyticsEligible, resolvePublicAnalyticsContext } from '@/lib/analytics/public-context'

const db = vi.hoisted(() => ({ business: { findUnique: vi.fn() }, analyticsCollectionPeriod: { findFirst: vi.fn() }, businessUser: { findFirst: vi.fn() }, $queryRaw: vi.fn() }))
const user = vi.hoisted(() => vi.fn())
vi.mock('@/lib/db', () => ({ prisma: db }))
vi.mock('@/lib/auth/user', () => ({ getCurrentUser: user }))
describe('public analytics context resolves actual canonical origin, never proxy hints', () => {
  beforeEach(() => {
    configureCapture(); vi.clearAllMocks()
    db.business.findUnique.mockResolvedValue({ id: 'biz-a', slug: 'salon', subdomain: 'salon', customDomain: 'salon.example.test', timezone: 'America/Santiago', isActive: true })
    db.analyticsCollectionPeriod.findFirst.mockResolvedValue({ id: 'period', definitionVersion: 1, consentVersion: 1 })
    db.$queryRaw.mockResolvedValue([{ oldest: null }])
    db.businessUser.findFirst.mockResolvedValue(null)
    user.mockResolvedValue(null)
  })
  afterEach(() => vi.unstubAllEnvs())
  const request = (origin = 'https://salon.agendita.test', extra = {}) => new Request(`${origin}/api/analytics/salon/session`, { method: 'POST', headers: { origin, ...extra } })
  it('resolves the active tenant through canonical subdomain, app host or exact custom domain', async () => {
    for (const origin of ['https://salon.agendita.test', 'https://agendita.test', 'https://salon.example.test']) expect(await resolvePublicAnalyticsContext(request(origin), 'salon')).toMatchObject({ businessId: 'biz-a', timezone: 'America/Santiago', origin })
  })
  it('SSR exposes only a boolean and fails closed for configuration, periods, staff and read errors', async () => {
    expect(await isPublicAnalyticsEligible('biz-a')).toBe(true)
    expect(await isPublicAnalyticsEligible('biz-b')).toBe(false)
    db.analyticsCollectionPeriod.findFirst.mockResolvedValueOnce(null)
    expect(await isPublicAnalyticsEligible('biz-a')).toBe(false)
    user.mockResolvedValue({ id: 'staff' }); db.businessUser.findFirst.mockResolvedValue({ id: 'member' })
    expect(await isPublicAnalyticsEligible('biz-a')).toBe(false)
    db.business.findUnique.mockRejectedValueOnce(new Error('offline'))
    expect(await isPublicAnalyticsEligible('biz-a')).toBe(false)
  })
  it('ignores forged internal headers, rejecting an unconfigured host', async () => {
    expect(await resolvePublicAnalyticsContext(request('https://evil.test', { 'x-business-subdomain': 'salon', 'x-forwarded-host': 'salon.agendita.test' }), 'salon')).toBeNull()
    expect(await resolvePublicAnalyticsContext(request('https://salon.agendita.test', { 'x-business-subdomain': 'other', 'x-forwarded-host': 'evil.test' }), 'salon')).not.toBeNull()
  })
  it('rejects missing/cross-site Origin and mismatched Host', async () => {
    for (const extra of [{ origin: '' }, { origin: 'https://other.agendita.test' }, { origin: 'https://salon.agendita.test/' }, { host: 'other.agendita.test' }]) expect(await resolvePublicAnalyticsContext(request(undefined, extra), 'salon')).toBeNull()
  })
  it('rejects opt-out, inactive, unallowlisted and invalid-zone businesses', async () => {
    db.analyticsCollectionPeriod.findFirst.mockResolvedValueOnce(null)
    expect(await resolvePublicAnalyticsContext(request(), 'salon')).toBeNull()
    for (const changed of [{ id: 'biz-b' }, { isActive: false }, { timezone: 'not-a-zone' }]) {
      db.business.findUnique.mockResolvedValueOnce({ id: 'biz-a', slug: 'salon', subdomain: 'salon', timezone: 'America/Santiago', isActive: true, ...changed })
      expect(await resolvePublicAnalyticsContext(request(), 'salon')).toBeNull()
    }
  })
  it('excludes bots, probes and authenticated members but not customers', async () => {
    expect(await resolvePublicAnalyticsContext(request(undefined, { 'user-agent': 'Googlebot' }), 'salon')).toBeNull()
    expect(await resolvePublicAnalyticsContext(request(undefined, { 'x-owner-analytics-probe': '1' }), 'salon')).toBeNull()
    user.mockResolvedValue({ id: 'user-a' }); db.businessUser.findFirst.mockResolvedValue({ id: 'membership' })
    expect(await resolvePublicAnalyticsContext(request(), 'salon')).toBeNull()
    db.businessUser.findFirst.mockResolvedValue(null)
    expect(await resolvePublicAnalyticsContext(request(), 'salon')).not.toBeNull()
  })
  it('fails closed if retention backlog is 12h overdue or a context dependency fails', async () => {
    db.$queryRaw.mockResolvedValueOnce([{ oldest: new Date(Date.now() - 13 * 60 * 60 * 1000) }])
    expect(await resolvePublicAnalyticsContext(request(), 'salon')).toBeNull()
    db.business.findUnique.mockRejectedValueOnce(new Error('database unavailable'))
    expect(await resolvePublicAnalyticsContext(request(), 'salon')).toBeNull()
  })
})
