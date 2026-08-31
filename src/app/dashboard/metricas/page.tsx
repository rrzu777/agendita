import { DashboardHeader } from '@/components/dashboard/header'
import { AnalyticsDashboard } from '@/components/dashboard/analytics/analytics-dashboard'
import { requireBusinessRole } from '@/lib/auth/server'
import { getOwnerAnalyticsReport } from '@/server/analytics/reports'

type SearchParams = Record<string, string | string[] | undefined>

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
  await requireBusinessRole(['owner', 'admin'])
  const report = await getOwnerAnalyticsReport(reportInput(await searchParams))

  return (
    <div>
      <DashboardHeader title="Métricas" subtitle="Observa el recorrido de reserva medido y qué conviene revisar después." />
      <AnalyticsDashboard report={report} />
    </div>
  )
}
