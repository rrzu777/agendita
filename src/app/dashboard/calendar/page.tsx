import { DashboardHeader } from '@/components/dashboard/header'
import { CalendarView } from '@/components/dashboard/calendar-view'

export default function CalendarPage() {
  return (
    <div>
      <DashboardHeader title="Calendario" subtitle="Vista mensual para revisar disponibilidad y citas." />
      <div className="max-w-4xl p-5 md:p-10">
        <CalendarView />
      </div>
    </div>
  )
}
