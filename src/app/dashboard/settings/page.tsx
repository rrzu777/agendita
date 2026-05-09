import { DashboardHeader } from '@/components/dashboard/header'

export default function SettingsPage() {
  return (
    <div>
      <DashboardHeader title="Configuración" />
      <div className="p-8">
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 text-center text-gray-500">
          Configuración en construcción...
        </div>
      </div>
    </div>
  )
}
