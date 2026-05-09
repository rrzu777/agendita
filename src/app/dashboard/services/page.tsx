import { DashboardHeader } from '@/components/dashboard/header'
import { ServiceTable } from '@/components/dashboard/service-table'
import { getServices } from '@/server/actions/services'

export default async function ServicesPage() {
  const services = await getServices()

  return (
    <div>
      <DashboardHeader title="Servicios" />
      <div className="p-8">
        <ServiceTable services={services} />
      </div>
    </div>
  )
}
