import { DashboardHeader } from '@/components/dashboard/header'
import { AvailabilityEditor } from '@/components/dashboard/availability-editor'
import { getAvailabilityRules } from '@/server/actions/availability'

export default async function AvailabilityPage() {
  const rules = await getAvailabilityRules()

  return (
    <div>
      <DashboardHeader title="Horarios de atención" />
      <div className="p-8 max-w-2xl">
        <p className="text-gray-600 mb-6">
          Configura tus horarios de atención por día de la semana. Los clientes solo podrán agendar en estos horarios.
        </p>
        <AvailabilityEditor rules={rules} />
      </div>
    </div>
  )
}
