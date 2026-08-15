import { redirect } from 'next/navigation'
import { DashboardHeader } from '@/components/dashboard/header'
import { getCustomerListStats, getCustomersPage } from '@/server/actions/customers'
import { getCurrentUserWithBusiness } from '@/lib/auth/user'
import { getVocabulary } from '@/lib/vocabulary'
import { CustomerList } from './customer-list'
import { getSingleSearchParam } from '@/components/dashboard/dashboard-pagination'

export const dynamic = 'force-dynamic'

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ cursor?: string | string[] }>
}) {
  const userData = await getCurrentUserWithBusiness()

  if (!userData?.user) {
    redirect('/login')
  }

  if (!userData?.business) {
    redirect('/recover-business')
  }

  const v = getVocabulary(userData.business.category)

  const cursor = getSingleSearchParam((await searchParams).cursor)
  let customerPage
  let stats
  let error: string | null = null
  try {
    ;[customerPage, stats] = await Promise.all([getCustomersPage({ cursor }), getCustomerListStats()])
  } catch (err) {
    error = err instanceof Error ? err.message : `Error al cargar ${v.clients}`
  }

  return (
    <div>
      <DashboardHeader
        title={v.Clients}
        subtitle="Historial y datos de contacto de quienes reservan contigo."
      />
      <div className="p-5 md:p-10">
        <CustomerList
          customers={customerPage?.items ?? []}
          nextCursor={customerPage?.nextCursor ?? null}
          stats={stats ?? { total: 0, withBookings: 0, withPendingBalance: 0 }}
          error={error}
          currency={userData.business.currency || 'CLP'}
        />
      </div>
    </div>
  )
}
