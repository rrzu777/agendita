import { redirect } from 'next/navigation'
import { DashboardHeader } from '@/components/dashboard/header'
import { getCustomers } from '@/server/actions/customers'
import { getCurrentUserWithBusiness } from '@/lib/auth/user'
import { CustomerList } from './customer-list'

export const dynamic = 'force-dynamic'

export default async function CustomersPage() {
  const userData = await getCurrentUserWithBusiness()

  if (!userData?.user) {
    redirect('/login')
  }

  if (!userData?.business) {
    redirect('/recover-business')
  }

  let customers
  let error: string | null = null
  try {
    customers = await getCustomers()
  } catch (err) {
    error = err instanceof Error ? err.message : 'Error al cargar clientes'
  }

  return (
    <div>
      <DashboardHeader
        title="Clientes"
        subtitle="Historial y datos de contacto de quienes reservan contigo."
      />
      <div className="p-5 md:p-10">
        <CustomerList customers={customers ?? []} error={error} currency={userData.business.currency || 'CLP'} />
      </div>
    </div>
  )
}
