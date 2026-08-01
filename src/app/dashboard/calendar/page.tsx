import { redirect } from 'next/navigation'
import { DashboardHeader } from '@/components/dashboard/header'
import { CalendarViews, type CalendarView } from '@/components/dashboard/calendar-views'
import { getBookingsByRange } from '@/server/actions/bookings'
import { getTimeBlocksByRange } from '@/server/actions/time-blocks'
import { getProfessionalNames } from '@/server/actions/professionals'
import { getCurrentUserWithBusiness } from '@/lib/auth/user'
import { isObjectStorageAvailable } from '@/lib/storage/r2'
import {
  parseISO,
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,
} from 'date-fns'
import { formatInTimeZone } from 'date-fns-tz'
import { endOfLocalDay, startOfLocalDay } from '@/lib/availability/timezone'

const WEEK_OPTS = { weekStartsOn: 1 as const }

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

function parseView(raw: string | undefined): CalendarView {
  return raw === 'day' || raw === 'week' || raw === 'month' ? raw : 'week'
}

/** Ventana [start, end] en instantes UTC que cubre la vista, en la zona del negocio. */
function rangeForView(view: CalendarView, focusLocalDate: Date, timezone: string) {
  let startLocal: Date
  let endLocal: Date
  if (view === 'day') {
    startLocal = focusLocalDate
    endLocal = focusLocalDate
  } else if (view === 'week') {
    startLocal = startOfWeek(focusLocalDate, WEEK_OPTS)
    endLocal = endOfWeek(focusLocalDate, WEEK_OPTS)
  } else {
    const mStart = startOfMonth(focusLocalDate)
    const mEnd = endOfMonth(focusLocalDate)
    startLocal = startOfWeek(mStart, WEEK_OPTS)
    endLocal = endOfWeek(mEnd, WEEK_OPTS)
  }
  // Usar las fechas de calendario locales para construir los límites en la zona del negocio.
  const startStr = formatInTimeZone(startLocal, 'UTC', 'yyyy-MM-dd')
  const endStr = formatInTimeZone(endLocal, 'UTC', 'yyyy-MM-dd')
  return {
    start: startOfLocalDay(startStr, timezone),
    end: endOfLocalDay(endStr, timezone),
  }
}

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; date?: string }>
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
  const view = parseView(params.view)

  // Día enfocado (yyyy-MM-dd). Default: hoy en la zona del negocio.
  const todayStr = formatInTimeZone(new Date(), timezone, 'yyyy-MM-dd')
  const dateStr = params.date && /^\d{4}-\d{2}-\d{2}$/.test(params.date) ? params.date : todayStr
  // parseISO con mediodía evita corrimientos de día al hacer aritmética de fechas.
  const focusLocalDate = parseISO(`${dateStr}T12:00:00Z`)

  const { start, end } = rangeForView(view, focusLocalDate, timezone)

  const [bookings, timeBlocks, professionals] = await Promise.all([
    getBookingsByRange(start, end),
    getTimeBlocksByRange(start, end),
    // Trae a las pausadas también: sus bloqueos siguen dibujados acá. Para el selector
    // de dueño se filtran las activas, que son las únicas a las que el servidor acepta
    // colgarle un bloqueo nuevo.
    getProfessionalNames(),
  ])
  const nombrePorId = new Map(professionals.map((p) => [p.id, p.name]))

  return (
    <div>
      <DashboardHeader
        title="Calendario"
        subtitle="Revisa tus citas por día, semana o mes."
      />
      <div className="max-w-6xl p-5 md:p-10">
        <CalendarViews
          bookings={serializeDates(bookings)}
          timeBlocks={timeBlocks.map((tb) => ({
            id: tb.id,
            startDateTime: tb.startDateTime.toISOString(),
            endDateTime: tb.endDateTime.toISOString(),
            reason: tb.reason ?? null,
            seriesId: tb.seriesId,
            occurrenceDate: tb.occurrenceDate ? tb.occurrenceDate.toISOString() : undefined,
            professionalName: tb.professionalId ? nombrePorId.get(tb.professionalId) ?? null : null,
          }))}
          view={view}
          date={dateStr}
          todayKey={todayStr}
          timezone={timezone}
          businessCurrency={business.currency}
          businessAddress={business.addressText}
          photoUploadEnabled={isObjectStorageAvailable()}
          professionals={professionals.filter((p) => p.isActive).map((p) => ({ id: p.id, name: p.name }))}
        />
      </div>
    </div>
  )
}
