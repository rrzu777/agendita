import { DashboardHeader } from '@/components/dashboard/header'
import { AnalyticsDashboard } from '@/components/dashboard/analytics/analytics-dashboard'
import { requireBusinessRole } from '@/lib/auth/server'
import { getOwnerAnalyticsReport } from '@/server/analytics/reports'
import { readWeeklyInsights } from '@/server/actions/weekly-insights'
import { DashboardSectionNav } from '@/components/dashboard/dashboard-section-nav'
import { getVocabulary } from '@/lib/vocabulary'

type SearchParams = Record<string, string | string[] | undefined>
export const metadata = { title: 'Métricas — Agendita' }

function numberParam(value: string | string[] | undefined) {
  if (typeof value !== 'string') return value
  const parsed = Number(value)
  return Number.isInteger(parsed) ? parsed : value
}

function reportInput(params: SearchParams) {
  return {
    days: numberParam(params.days),
    from: params.from,
    to: params.to,
    channel: params.channel,
    acquisitionLinkId: params.acquisitionLinkId,
    serviceId: params.serviceId,
    page: numberParam(params.page),
    pageSize: numberParam(params.pageSize),
  }
}

export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const { business, role } = await requireBusinessRole(['owner', 'admin'])
  const input = reportInput(await searchParams)
  const report = await getOwnerAnalyticsReport(input)
  let weeklyInsights = null
  try { weeklyInsights = await readWeeklyInsights({ limit: 4 }) } catch { weeklyInsights = null }
  const days = input.from !== undefined || input.to !== undefined ? null : input.days === undefined ? 28 : input.days === 7 || input.days === 28 || input.days === 90 ? input.days : null
  return (
    <div>
      <DashboardHeader title="Métricas" subtitle="Observa el recorrido de reserva medido y qué conviene revisar después." />
      <div className="px-5 pt-5 md:px-10 md:pt-8">
        <DashboardSectionNav section="growth" vocabulary={getVocabulary(business.category)} role={role} className="mb-0" />
      </div>
      <AnalyticsDashboard report={report} periodMode={{ days }} weeklyInsights={weeklyInsights} />
    </div>
  )
}
