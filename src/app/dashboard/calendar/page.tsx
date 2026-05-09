import { DashboardHeader } from '@/components/dashboard/header'
import { CalendarView } from '@/components/dashboard/calendar-view'

export default function CalendarPage() {
  return (
    <div>
      <DashboardHeader title="Calendario" />
      <div className="p-8 max-w-3xl">
        <CalendarView />
      </div>
    </div>
  )
}
