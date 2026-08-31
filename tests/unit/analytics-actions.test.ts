// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { configureCapture } from '../helpers/analytics-capture'
import { createAcquisitionLink, archiveAcquisitionLink, setAnalyticsCollectionEnabled } from '@/server/actions/analytics'

const auth = vi.hoisted(() => vi.fn())
const db = vi.hoisted(() => ({ acquisitionLink: { create: vi.fn(), updateMany: vi.fn() }, promotion: { findFirst: vi.fn() }, analyticsCollectionPeriod: { findFirst: vi.fn(), create: vi.fn(), updateMany: vi.fn() }, $queryRaw: vi.fn(), $executeRaw: vi.fn(), $transaction: vi.fn() }))
vi.mock('@/lib/auth/user', () => ({ getCurrentUserWithBusiness: auth, getCurrentUser: async () => null }))
vi.mock('@/lib/db', () => ({ prisma: db }))
vi.mock('@/lib/upstash-rest', () => ({ executeUpstashCommand: async () => 1 }))
vi.mock('next/cache', () => ({ revalidatePath: () => {} }))
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: async () => ({ success: true }) }))

describe('owner/admin acquisition and collection mutations', () => {
  beforeEach(() => {
    configureCapture(); vi.clearAllMocks()
    auth.mockResolvedValue({ user: { id: 'owner' }, role: 'owner', business: { id: 'biz-a', slug: 'salon', subdomain: 'salon', timezone: 'America/Santiago', isActive: true } })
    db.$transaction.mockImplementation((fn) => fn(db)); db.$queryRaw.mockResolvedValue([{ oldest: null }])
    db.analyticsCollectionPeriod.findFirst.mockResolvedValue(null)
    db.analyticsCollectionPeriod.create.mockImplementation(({ data }) => ({ id: 'period', ...data }))
    db.analyticsCollectionPeriod.updateMany.mockResolvedValue({ count: 1 })
    db.acquisitionLink.create.mockImplementation(({ data }) => ({ id: 'link-a', ...data, createdAt: new Date(), archivedAt: null }))
    db.acquisitionLink.updateMany.mockResolvedValue({ count: 1 })
    db.promotion.findFirst.mockResolvedValue(null)
  })
  afterEach(() => vi.unstubAllEnvs())
  it('denies every mutation for staff even with caller-supplied business identity', async () => {
    auth.mockResolvedValue({ user: { id: 'staff' }, role: 'staff', business: { id: 'biz-a' } })
    for (const result of [await createAcquisitionLink({ channel: 'instagram', campaignName: 'Campaña' }), await archiveAcquisitionLink('link-a'), await setAnalyticsCollectionEnabled(false)]) expect(result.ok).toBe(false)
    expect(db.acquisitionLink.create).not.toHaveBeenCalled()
    expect(db.analyticsCollectionPeriod.updateMany).not.toHaveBeenCalled()
  })
  it('creates a canonical opaque link, with business derived from authenticated membership', async () => {
    const result = await createAcquisitionLink({ channel: 'instagram', campaignName: 'Primavera' })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.url).toMatch(/^https:\/\/salon.agendita.test\/book\?acq=[A-Za-z0-9_-]{22}$/)
      expect(result.data).toMatchObject({ campaignName: 'Primavera', channel: 'instagram', promotionId: null })
    }
    expect((await createAcquisitionLink({ channel: 'instagram', campaignName: 'Primavera', businessId: 'foreign' })).ok).toBe(false)
  })
  it('rejects foreign promotions, arbitrary channels and unsafe campaign labels', async () => {
    for (const input of [{ channel: 'invented', campaignName: 'Season' }, { channel: 'google', campaignName: '<script>' }, { channel: 'google', campaignName: 'x'.repeat(81) }, { channel: 'google', campaignName: 'name@example.com' }, { channel: 'google', campaignName: 'Season', promotionId: 'foreign' }]) expect((await createAcquisitionLink(input)).ok).toBe(false)
    expect(db.acquisitionLink.create).not.toHaveBeenCalled()
  })
  it('archives only the authenticated tenant link and never changes attribution', async () => {
    expect((await archiveAcquisitionLink('link-a')).ok).toBe(true)
    expect(db.acquisitionLink.updateMany.mock.calls[0][0]).toEqual({ where: { businessId: 'biz-a', id: 'link-a', archivedAt: null }, data: { archivedAt: expect.any(Date) } })
    db.acquisitionLink.updateMany.mockResolvedValue({ count: 0 })
    expect((await archiveAcquisitionLink('foreign')).ok).toBe(false)
  })
  it('requires operational gates to enable, while disabling remains available with flag/Redis absent', async () => {
    expect((await setAnalyticsCollectionEnabled(true)).ok).toBe(true)
    vi.stubEnv('OWNER_ANALYTICS_PRIVACY_APPROVED', '')
    expect((await setAnalyticsCollectionEnabled(true)).ok).toBe(false)
    vi.stubEnv('OWNER_ANALYTICS_ENABLED', 'false'); vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', '')
    expect((await setAnalyticsCollectionEnabled(false)).ok).toBe(true)
    expect(db.analyticsCollectionPeriod.updateMany.mock.calls.at(-1)?.[0]).toMatchObject({ where: { businessId: 'biz-a', endedAt: null }, data: { closeReason: 'operator' } })
    expect(process.env.OWNER_ANALYTICS_ENABLED).toBe('false')
  })
})
