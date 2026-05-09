import { DashboardHeader } from '@/components/dashboard/header'

export default function BookingsPage() {
  return (
    <div>
      <DashboardHeader title="Reservas" />
      <div className="p-8">
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 text-center text-gray-500">
          Gestión de reservas en construcción...
        </div>
      </div>
    </div>
  )
}
