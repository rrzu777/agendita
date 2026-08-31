import 'server-only'
import { Prisma } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { requireBusinessRole } from '@/lib/auth/server'
import { UserError } from '@/lib/actions/result'
import { dimensionIdSchema } from '@/lib/analytics/contracts'

const inputSchema = z.strictObject({ kind: z.enum(['service', 'link', 'promotion']), search: z.string().trim().max(80).default(''), page: z.number().int().min(1).max(1000).default(1), selectedId: dimensionIdSchema.optional() })
export type AnalyticsOptionKind = z.infer<typeof inputSchema>['kind']
export type AnalyticsOption = { id: string; label: string }
export type AnalyticsOptionPage = { rows: AnalyticsOption[]; page: number; hasMore: boolean; selected: AnalyticsOption | null }

/** Management choices are not metric cells. Every bounded page authorizes its
 * tenant independently, including archived links and retained historical services. */
export async function getOwnerAnalyticsOptions(input: unknown, now = new Date()): Promise<AnalyticsOptionPage> {
  const { businessId } = await requireBusinessRole(['owner', 'admin'])
  const parsed = inputSchema.safeParse(input)
  if (!parsed.success) throw new UserError('Opciones de métricas inválidas.')
  const { kind, search, page, selectedId } = parsed.data
  const source = kind === 'service' ? Prisma.sql`
    SELECT "id", "name" AS label FROM "Service" WHERE "businessId" = ${businessId}
    UNION
    SELECT DISTINCT m."dimensionKey" AS id, COALESCE(s."name", 'Servicio eliminado · ' || m."dimensionKey") AS label
    FROM "AnalyticsDailyMetric" m LEFT JOIN "Service" s ON s."id" = m."dimensionKey" AND s."businessId" = ${businessId}
    WHERE m."businessId" = ${businessId} AND m.grain = 'service' AND m."retentionExpiresAt" > ${now}
  ` : kind === 'link' ? Prisma.sql`
    SELECT id, "campaignName" || CASE WHEN "archivedAt" IS NULL THEN '' ELSE ' (archivado)' END AS label
    FROM "AcquisitionLink" WHERE "businessId" = ${businessId}
  ` : Prisma.sql`
    SELECT id, name AS label FROM "Promotion" WHERE "businessId" = ${businessId}
  `
  // Association eligibility matches createAcquisitionLink: owned promotion, not
  // coupon redemption eligibility. No codes, terms or customer data are returned.
  return prisma.$transaction(async tx => {
    const found = await tx.$queryRaw<AnalyticsOption[]>(Prisma.sql`SELECT id, label FROM (${source}) options WHERE strpos(lower(label), lower(${search})) > 0 ORDER BY label, id LIMIT 101 OFFSET ${(page - 1) * 100}`)
    const rows = found.slice(0, 100)
    // Never return an extra identity beyond this page's 100 choices. The UI
    // preserves an out-of-page filter with an explicit unavailable-name label.
    const selected = selectedId ? rows.find(row => row.id === selectedId) ?? null : null
    return { rows, page, hasMore: found.length > 100, selected }
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 5000, maxWait: 5000 })
}
