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
      <DashboardHeader title="Servicios" subtitle="Gestiona catálogo, precios, abonos y duración de tus tratamientos." />
      <div className="p-5 md:p-10">
        <ServiceTable services={services} businessId={userData.business.id} />
      </div>
    </div>
  )
}
