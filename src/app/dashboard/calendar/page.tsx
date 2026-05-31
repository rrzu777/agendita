import { redirect } from 'next/navigation'
import { DashboardHeader } from '@/components/dashboard/header'
import { CalendarGrid } from '@/components/dashboard/calendar-grid'
import { DayPanel } from '@/components/dashboard/day-panel'
import { getBookingsByRange } from '@/server/actions/bookings'
import { getTimeBlocksByRange } from '@/server/actions/time-blocks'
import { getCurrentUserWithBusiness } from '@/lib/auth/user'
import { startOfMonth, endOfMonth, parseISO } from 'date-fns'
import { fromZonedTime, toZonedTime } from 'date-fns-tz'
import { groupBookingsByDay } from '@/lib/calendar/group-by-day'

function serializeDates<T extends { startDateTime: Date; endDateTime: Date }>(
  items: T[]
): Array<Omit<T, 'startDateTime' | 'endDateTime'> & { startDateTime: string; endDateTime: string }> {
  return items.map((item) => ({
    ...item,
    startDateTime: item.startDateTime.toISOString(),
    endDateTime: item.endDateTime.toISOString(),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- generic spread with overridden Date→string fields
  })) as any
}

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; date?: string }>
}) {
  const userData = await getCurrentUserWithBusiness()
  if (!userData?.user) {
    redirect('/login')
  }

  if (!userData?.business) {
    redirect('/recover-business')
  }

  const business = userData.business
  const timezone = business.timezone || 'America/Santiago'

  const params = await searchParams
  const monthParam = params.month
  const baseDate = monthParam ? parseISO(`${monthParam}-01`) : new Date()
  const currentMonth = startOfMonth(baseDate)

  const zonedNow = toZonedTime(currentMonth, timezone)
  const monthStart = fromZonedTime(startOfMonth(zonedNow), timezone)
  const monthEnd = fromZonedTime(endOfMonth(zonedNow), timezone)

  const [bookings, timeBlocks] = await Promise.all([
    getBookingsByRange(monthStart, monthEnd),
    getTimeBlocksByRange(monthStart, monthEnd),
  ])

  const bookingsByDay = groupBookingsByDay(bookings, timezone)
  const _timeBlocksByDay = groupBookingsByDay(timeBlocks, timezone) as unknown as typeof bookingsByDay

  const selectedDate = params.date || null

  return (
    <div>
      <DashboardHeader
        title="Calendario"
        subtitle="Vista mensual para revisar disponibilidad y citas."
      />
      <div className="max-w-4xl p-5 md:p-10">
        <CalendarGrid
          bookingsByDay={bookingsByDay}
          currentMonth={currentMonth}
          selectedDate={selectedDate}
        />
        <DayPanel
          bookings={serializeDates(bookings)}
          timeBlocks={serializeDates(timeBlocks)}
          selectedDate={selectedDate}
          businessCurrency={business.currency}
          timezone={timezone}
          businessAddress={business.addressText}
        />
      </div>
    </div>
  )
}
