import { redirect } from 'next/navigation'
import { DashboardHeader } from '@/components/dashboard/header'
import { ServiceTable } from '@/components/dashboard/service-table'
import { getServices } from '@/server/actions/services'
import { getCurrentUserWithBusiness } from '@/lib/auth/user'

export default async function ServicesPage() {
  const userData = await getCurrentUserWithBusiness()

  if (!userData?.business) {
    redirect('/login')
  }

  const services = await getServices(userData.business.id)

  return (
    <div>
      <DashboardHeader title="Servicios" />
      <div className="p-8">
        <ServiceTable services={services} />
      </div>
    </div>
  )
}
