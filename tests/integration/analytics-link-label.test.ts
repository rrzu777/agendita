import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { prisma, seedAnalyticsReport } from '../helpers/analytics-report-db'
import { renameAcquisitionLink } from '@/server/actions/analytics'
import { getOwnerAnalyticsReport } from '@/server/analytics/reports'
import { publishAnalyticsCohort } from '@/server/analytics/maintenance'

const auth = vi.hoisted(() => vi.fn())
const rate = vi.hoisted(() => vi.fn())
vi.mock('@/lib/auth/user', () => ({ getCurrentUserWithBusiness: auth }))
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: rate }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
const ids: string[] = []
afterEach(async () => { await prisma.business.deleteMany({ where: { id: { in: ids } } }); ids.length = 0; vi.unstubAllEnvs() })
afterAll(() => prisma.$disconnect())

async function fixture(archived = false) {
  vi.stubEnv('OWNER_ANALYTICS_ENABLED', 'false')
  rate.mockResolvedValue({ success: true })
  const f = await seedAnalyticsReport(); ids.push(f.businessId)
  const other = await seedAnalyticsReport(); ids.push(other.businessId)
  const promotion = await prisma.promotion.create({ data: { businessId: f.businessId, name: 'Synthetic association', rewardType: 'fixed_amount', rewardValue: 1 } })
  const link = await prisma.acquisitionLink.create({ data: { businessId: f.businessId, token: crypto.randomUUID(), campaignName: 'Etiqueta anterior', channel: 'instagram', promotionId: promotion.id, createdAt: f.session.startedAt, archivedAt: archived ? new Date(+f.session.startedAt + 1000) : null } })
  const foreign = await prisma.acquisitionLink.create({ data: { businessId: other.businessId, token: crypto.randomUUID(), campaignName: 'Otra etiqueta', channel: 'google' } })
  await prisma.analyticsSession.update({ where: { id: f.session.id }, data: { acquisitionLinkId: link.id } })
  await prisma.bookingFunnelAttempt.update({ where: { id: f.attempt.id }, data: { acquisitionLinkId: link.id } })
  await prisma.booking.update({ where: { id: f.booking.id }, data: { analyticsAcquisitionLinkId: link.id } })
  await publishAnalyticsCohort(f.cohort)
  auth.mockResolvedValue({ user: { id: 'synthetic' }, role: 'owner', business: { id: f.businessId, timezone: 'UTC', slug: f.businessId } })
  const snapshot = () => Promise.all([
    prisma.acquisitionLink.findMany({ where: { businessId: { in: ids } }, orderBy: { id: 'asc' } }),
    prisma.analyticsSession.findMany({ where: { businessId: { in: ids } }, orderBy: { id: 'asc' } }),
    prisma.bookingFunnelAttempt.findMany({ where: { businessId: { in: ids } }, orderBy: { id: 'asc' } }),
    prisma.booking.findMany({ where: { businessId: { in: ids } }, orderBy: { id: 'asc' } }),
    prisma.analyticsDailyMetric.findMany({ where: { businessId: { in: ids } }, orderBy: { id: 'asc' } }),
    prisma.bookingFunnelEvent.findMany({ where: { businessId: { in: ids } }, orderBy: { id: 'asc' } }),
  ])
  return { f, link, foreign, snapshot }
}

describe('current acquisition label mutation without historical rewriting', () => {
  it.each(['owner', 'admin'] as const)('lets %s rename only campaignName, including archived links and current report labels', async role => {
    const { f, link, snapshot } = await fixture(role === 'admin')
    auth.mockResolvedValue({ user: { id: 'synthetic' }, role, business: { id: f.businessId, timezone: 'UTC', slug: f.businessId } })
    const before = await snapshot()
    expect(typeof renameAcquisitionLink).toBe('function')
    expect(await renameAcquisitionLink({ id: link.id, campaignName: '  Etiqueta actual  ' })).toEqual({ ok: true, data: { renamed: true } })
    const after = await snapshot()
    expect(after[0]).toEqual(before[0].map(row => row.id === link.id ? { ...row, campaignName: 'Etiqueta actual' } : row))
    expect(after.slice(1)).toEqual(before.slice(1))
    const report = await getOwnerAnalyticsReport({ from: '2026-08-01', to: '2026-08-02' }, f.cohort.now)
    expect(report.acquisitionLinks.rows.find(row => row.id === link.id)?.campaignName).toBe('Etiqueta actual')
    expect(report.links.rows.find(row => row.id === link.id)?.label).toBe('Etiqueta actual')
  })
  it.each(['foreign', 'missing', 'staff', 'anonymous', 'rate', 'businessId', 'token', 'channel', 'promotionId', 'archivedAt', 'createdAt', 'empty', 'long', 'email', 'url', 'phone', 'markup'] as const)('rejects %s without changing links or attribution', async kind => {
    const { f, link, foreign, snapshot } = await fixture()
    const input: Record<string, unknown> = { id: link.id, campaignName: 'Nueva etiqueta' }
    if (kind === 'foreign') input.id = foreign.id
    if (kind === 'missing') input.id = 'missing-link'
    if (kind === 'staff') auth.mockResolvedValue({ user: { id: 'staff' }, role: 'staff', business: { id: f.businessId } })
    if (kind === 'anonymous') auth.mockResolvedValue(null)
    if (kind === 'rate') rate.mockResolvedValue({ success: false })
    if (['businessId', 'token', 'channel', 'promotionId', 'archivedAt', 'createdAt'].includes(kind)) input[kind] = foreign.id
    const invalid = { empty: '   ', long: 'a'.repeat(81), email: 'name@example.com', url: 'https://example.com', phone: '12345678', markup: '<b>label</b>' }
    if (kind in invalid) input.campaignName = invalid[kind as keyof typeof invalid]
    const before = await snapshot()
    const result = await renameAcquisitionLink(input)
    expect(result.ok).toBe(false)
    if (kind === 'foreign' || kind === 'missing') expect(result).toEqual({ ok: false, error: 'Enlace no disponible' })
    expect(await snapshot()).toEqual(before)
  })
})
