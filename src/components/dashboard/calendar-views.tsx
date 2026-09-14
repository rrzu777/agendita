'use client'

import { bookingServiceName } from '@/lib/bookings/service-lines'
import { useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  format,
  addDays,
  subDays,
  addWeeks,
  subWeeks,
  addMonths,
  subMonths,
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,
  eachDayOfInterval,
  isSameMonth,
  parseISO,
} from 'date-fns'
import { es } from 'date-fns/locale'
import { formatInTimeZone } from 'date-fns-tz'
import { Button } from '@/components/ui/button'
import { ChevronDown, ChevronLeft, ChevronRight, Clock, Check, X, Minus } from 'lucide-react'
import { BookingDrawer } from './booking-drawer'
import { BlockTimeModal } from './block-time-modal'
import { EditBlockDialog } from './edit-block-dialog'
import { EditSeriesOccurrenceDialog } from './edit-series-occurrence-dialog'
import type { CalendarBooking } from './booking-card'
import type { CalendarTimeBlock } from './time-block-card'
import { SCOPE_PARAM } from './schedule-scope-picker'
import { WHOLE_BUSINESS_LABEL } from '@/lib/professionals/scope-label'
import {
  localDayKey,
  computeHourRange,
  buildTimelineAxis,
  packSegmentLanes,
  segmentItemsByLocalDays,
  type PositionedSegment,
  type TimelineAxis,
  type TimelineSegment,
} from '@/lib/calendar/timeline'
import { bookingAppearance, type StatusIcon } from '@/lib/calendar/booking-appearance'
import { bookingStatusLabel, displayedBookingStatus } from '@/lib/bookings/status-labels'
import { useVocabulary } from '@/components/vocabulary-provider'
import { DashboardPanel } from './dashboard-panel'

export type CalendarView = 'day' | 'week' | 'month'

export type TimelineBooking = CalendarBooking & {
  service: { name: string; pastelColor?: string } | null
}

interface CalendarViewsProps {
  bookings: TimelineBooking[]
  timeBlocks: CalendarTimeBlock[]
  view: CalendarView
  /** Día enfocado en formato yyyy-MM-dd */
  date: string
  /**
   * El reloj del SERVIDOR para este render — el porqué está en
   * `effectiveBookingStatus`. Acá gobierna DOS cosas: el día resaltado ("hoy")
   * y el estado derivado del chip. Es un solo prop y no también el `todayKey`
   * que había: dos props que tienen que ser el mismo instante son una
   * invariante que nadie chequea, y el fixture de los tests ya la violaba. El
   * día se deriva de acá con `localDayKey`.
   */
  now: Date
  timezone: string
  businessCurrency: string
  businessAddress: string | null
  /** false si R2 no está configurado: el drawer muestra las fotos que haya pero
   *  no ofrece subir más. Se calcula en el servidor (lee env). */
  photoUploadEnabled: boolean
  /** Quiénes atienden, para poder bloquearle el rato a una sola persona desde acá. */
  professionals: { id: string; name: string }[]
  /** Filtro por persona (?persona=), ya validado por el servidor contra la
   *  lista real. null = todo el equipo. El filtrado de citas/bloqueos lo hace
   *  el servidor con el mismo predicado del motor de agenda; acá solo se
   *  mantiene el parámetro vivo en cada link y se dibuja el selector. */
  selectedProfessionalId: string | null
}

const HOUR_HEIGHT = 56 // px por hora
const TARGET_SIZE = 44
const EVENT_GAP = 4
const MIN_LANE_WIDTH = 64 // room for a full HH:mm label beside its status icon
const WEEK_STARTS = { locale: es, weekStartsOn: 1 } as const

const statusIcons: Record<StatusIcon, typeof Clock> = {
  clock: Clock,
  check: Check,
  x: X,
  dash: Minus,
}

/**
 * EL builder de URLs del calendario — el único. El filtro por persona tiene que
 * sobrevivir a CADA navegación interna (anterior/siguiente, Hoy, cambiar de
 * vista, click en un día): si un solo link arma la URL a mano y lo pierde, el
 * filtro "se suelta" al navegar. Por eso el `&persona=` se escribe acá y en
 * ningún otro lado, con el nombre del parámetro importado del contrato
 * compartido del panel (SCOPE_PARAM).
 */
function calendarHref(view: CalendarView, date: string, personaId: string | null): string {
  const persona = personaId ? `&${SCOPE_PARAM}=${personaId}` : ''
  return `/dashboard/calendar?view=${view}&date=${date}${persona}`
}

export function CalendarViews({
  bookings,
  timeBlocks,
  view,
  date,
  now,
  timezone,
  businessCurrency,
  businessAddress,
  photoUploadEnabled,
  professionals,
  selectedProfessionalId,
}: CalendarViewsProps) {
  const todayKey = localDayKey(now, timezone)
  const focus = parseISO(`${date}T12:00:00`)
  const [activeBooking, setActiveBooking] = useState<TimelineBooking | null>(null)
  const bookingTrigger = useRef<HTMLElement | null>(null)
  function openBooking(booking: TimelineBooking) {
    bookingTrigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setActiveBooking(booking)
  }
  const [activeBlock, setActiveBlock] = useState<CalendarTimeBlock | null>(null)
  const blockTrigger = useRef<HTMLElement | null>(null)
  function openBlock(block: CalendarTimeBlock) {
    blockTrigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setActiveBlock(block)
  }
  function restoreBlockFocus(event: Event) {
    if (blockTrigger.current?.isConnected) {
      event.preventDefault()
      blockTrigger.current.focus()
    }
  }

  // Navegación previo/siguiente según la vista
  const prev =
    view === 'day' ? subDays(focus, 1) : view === 'week' ? subWeeks(focus, 1) : subMonths(focus, 1)
  const next =
    view === 'day' ? addDays(focus, 1) : view === 'week' ? addWeeks(focus, 1) : addMonths(focus, 1)

  let periodLabel: string
  if (view === 'day') {
    periodLabel = format(focus, "EEEE d 'de' MMMM", { locale: es })
  } else if (view === 'week') {
    const ws = startOfWeek(focus, WEEK_STARTS)
    const we = endOfWeek(focus, WEEK_STARTS)
    periodLabel = `${format(ws, "d MMM", { locale: es })} – ${format(we, "d MMM yyyy", { locale: es })}`
  } else {
    periodLabel = format(focus, 'MMMM yyyy', { locale: es })
  }

  return (
    <DashboardPanel title="Agenda" description={`Horarios en ${timezone}`}>
      {/* Barra de control — apila hasta lg para no apretarse en tablet */}
      <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="icon" className="size-11" asChild>
            <Link href={calendarHref(view, format(prev, 'yyyy-MM-dd'), selectedProfessionalId)} aria-label="Anterior">
              <ChevronLeft className="size-4" />
            </Link>
          </Button>
          <Button variant="outline" className="min-h-11 min-w-11" asChild>
            <Link href={calendarHref(view, todayKey, selectedProfessionalId)}>Hoy</Link>
          </Button>
          <Button variant="outline" size="icon" className="size-11" asChild>
            <Link href={calendarHref(view, format(next, 'yyyy-MM-dd'), selectedProfessionalId)} aria-label="Siguiente">
              <ChevronRight className="size-4" />
            </Link>
          </Button>
          <h3 className="w-full break-words font-heading text-lg font-semibold capitalize text-foreground min-[721px]:ml-1 min-[721px]:w-auto">
            {periodLabel}
          </h3>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Con una sola persona el filtro es un no-op (lo suyo + lo del
              negocio = todo): mismo criterio que el funnel, que con una sola
              tampoco pregunta. */}
          {professionals.length > 1 && (
            <ProfessionalFilter
              professionals={professionals}
              selected={selectedProfessionalId}
              view={view}
              date={date}
            />
          )}
          <ViewSwitch view={view} date={date} personaId={selectedProfessionalId} />
          {view !== 'month' && (
            // Con el filtro puesto SÍ hay una persona "que se está mirando":
            // el bloqueo nuevo arranca en ella, no en "todo el negocio" (el
            // default más caro de equivocarse — cierra el local entero).
            <BlockTimeModal
              defaultDate={date}
              timezone={timezone}
              professionals={professionals}
              defaultProfessionalId={selectedProfessionalId}
            />
          )}
        </div>
      </div>

      {bookings.length === 0 && timeBlocks.length === 0 && <p role="status" className="mb-4 rounded-lg bg-muted p-3 text-sm text-muted-foreground">No hay citas ni bloqueos en este período.</p>}

      {view === 'month' && (
        <MonthView
          bookings={bookings}
          focus={focus}
          timezone={timezone}
          now={now}
          personaId={selectedProfessionalId}
          onBookingClick={openBooking}
        />
      )}
      {view === 'week' && (
        <>
        <div className="min-[721px]:hidden">
          <WeekAgenda focus={focus} personaId={selectedProfessionalId} bookings={bookings} timeBlocks={timeBlocks} timezone={timezone} now={now} onBookingClick={openBooking} onBlockClick={openBlock} />
        </div>
        <div className="hidden min-[721px]:block">
        <TimelineView
          days={eachDayOfInterval({
            start: startOfWeek(focus, WEEK_STARTS),
            end: endOfWeek(focus, WEEK_STARTS),
          })}
          bookings={bookings}
          timeBlocks={timeBlocks}
          timezone={timezone}
          now={now}
          personaId={selectedProfessionalId}
          onBookingClick={openBooking}
          onBlockClick={openBlock}
        />
        </div>
        </>
      )}
      {view === 'day' && (
        <TimelineView
          days={[focus]}
          bookings={bookings}
          timeBlocks={timeBlocks}
          timezone={timezone}
          now={now}
          personaId={selectedProfessionalId}
          onBookingClick={openBooking}
          onBlockClick={openBlock}
        />
      )}

      {activeBooking && (
        <BookingDrawer
          booking={activeBooking}
          open={!!activeBooking}
          onOpenChange={(o) => !o && setActiveBooking(null)}
          onCloseAutoFocus={(event) => {
            if (bookingTrigger.current?.isConnected) {
              event.preventDefault()
              bookingTrigger.current.focus()
            }
          }}
          businessCurrency={businessCurrency}
          businessTimezone={timezone}
          businessAddress={businessAddress}
          photoUploadEnabled={photoUploadEnabled}
          hasTeam={professionals.length > 0}
          // El MISMO reloj que el chip desde el que se abre (ver #160).
          now={now}
        />
      )}

      {activeBlock && (activeBlock.seriesId ? (
        <EditSeriesOccurrenceDialog
          key={activeBlock.id}
          block={activeBlock}
          timezone={timezone}
          open={!!activeBlock}
          onOpenChange={(o) => !o && setActiveBlock(null)}
          onCloseAutoFocus={restoreBlockFocus}
        />
      ) : (
        <EditBlockDialog
          key={activeBlock.id}
          block={activeBlock}
          timezone={timezone}
          open={!!activeBlock}
          onOpenChange={(o) => !o && setActiveBlock(null)}
          onCloseAutoFocus={restoreBlockFocus}
        />
      ))}
    </DashboardPanel>
  )
}

function WeekAgenda({ focus, personaId, bookings, timeBlocks, timezone, now, onBookingClick, onBlockClick }: {
  focus: Date
  personaId: string | null
  bookings: TimelineBooking[]
  timeBlocks: CalendarTimeBlock[]
  timezone: string
  now: Date
  onBookingClick: (booking: TimelineBooking) => void
  onBlockClick: (block: CalendarTimeBlock) => void
}) {
  const v = useVocabulary()
  const days = eachDayOfInterval({ start: startOfWeek(focus, WEEK_STARTS), end: endOfWeek(focus, WEEK_STARTS) })
  const dayKeys = days.map((day) => format(day, 'yyyy-MM-dd'))
  const bookingSegments = segmentItemsByLocalDays(bookings, dayKeys, timezone)
  const blockSegments = segmentItemsByLocalDays(timeBlocks, dayKeys, timezone)
  return (
    <section aria-label="Agenda de la semana" className="divide-y divide-border">
      {days.map((day) => {
        const key = format(day, 'yyyy-MM-dd')
        const entries = [
          ...bookingSegments.filter((segment) => segment.dayKey === key).map((segment) => ({ key: `booking-${key}-${segment.item.id}`, start: segment.segmentStart.getTime(), node: <button type="button" onClick={() => onBookingClick(segment.item)} aria-label={`Abrir detalle de ${bookingSegmentLabel(segment, timezone, now, v.Client)}`} className="w-full rounded-lg border border-border bg-card p-3 text-left hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring">
            <span className="block text-sm font-semibold">{segmentTimeRange(segment, timezone)} · {segment.item.customer?.name || v.Client}</span>
            <span className="mt-1 block break-words text-sm text-muted-foreground">{bookingServiceName(segment.item)}</span>
            <span className="mt-1 block text-xs text-muted-foreground">{bookingStatusLabel(displayedBookingStatus(segment.item, now))}{segment.item.professional?.name ? ` · ${segment.item.professional.name}` : ''}{continuationDescription(segment, timezone)}</span>
          </button> })),
          ...blockSegments.filter((segment) => segment.dayKey === key).map((segment) => ({ key: `block-${key}-${segment.item.id}`, start: segment.segmentStart.getTime(), node: <button type="button" onClick={() => onBlockClick(segment.item)} aria-label={`Abrir ${blockSegmentLabel(segment, timezone)}`} className="w-full rounded-lg border border-dashed border-border bg-muted p-3 text-left hover:bg-muted/70 focus-visible:ring-2 focus-visible:ring-ring">
            <span className="block text-sm font-semibold">{segmentTimeRange(segment, timezone)} · Bloqueo{segment.item.professionalName ? ` de ${segment.item.professionalName}` : ''}</span>
            <span className="mt-1 block break-words text-sm text-muted-foreground">{segment.item.reason || 'No disponible'}{continuationDescription(segment, timezone)}</span>
          </button> })),
        ].sort((a, b) => a.start - b.start)
        return <div key={key} data-calendar-day={key} className="py-3 first:pt-0">
          <Link href={calendarHref('day', key, personaId)} className="mb-2 flex min-h-11 items-center font-medium capitalize hover:text-primary">{format(day, "EEEE d 'de' MMMM", { locale: es })}</Link>
          {entries.length ? <ul className="space-y-2">{entries.map((entry) => <li key={entry.key}>{entry.node}</li>)}</ul> : <p className="text-sm text-muted-foreground">Sin citas ni bloqueos</p>}
        </div>
      })}
    </section>
  )
}

function ViewSwitch({ view, date, personaId }: { view: CalendarView; date: string; personaId: string | null }) {
  const options: Array<{ key: CalendarView; label: string }> = [
    { key: 'day', label: 'Día' },
    { key: 'week', label: 'Semana' },
    { key: 'month', label: 'Mes' },
  ]
  return (
    <nav aria-label="Vista del calendario" className="inline-flex rounded-lg border border-border bg-muted/40 p-0.5">
      {options.map((o) => (
        <Link
          key={o.key}
          href={calendarHref(o.key, date, personaId)}
          aria-current={view === o.key ? 'page' : undefined}
          className={`inline-flex min-h-11 items-center rounded-md px-3 py-2 text-sm font-medium transition-colors ${
            view === o.key
              ? 'bg-card text-primary shadow-sm'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          {o.label}
        </Link>
      ))}
    </nav>
  )
}

/**
 * El filtro por persona. Navega en vez de filtrar en memoria: el parámetro
 * tiene que quedar en la URL para sobrevivir a anterior/siguiente/Hoy (que son
 * Links al servidor), y el filtrado ya lo hizo la página con los predicados
 * del motor de agenda.
 *
 * `<select>` nativo a propósito (y no el Select de ui ni el patrón links de
 * ScheduleScopePicker): acá la lista puede ser larga y el control convive
 * apretado con la barra del calendario; el nativo da teclado y móvil gratis.
 * La opción nula usa WHOLE_BUSINESS_LABEL, la redacción única del alcance
 * "sin persona" en todo el panel.
 */
function ProfessionalFilter({
  professionals,
  selected,
  view,
  date,
}: {
  professionals: { id: string; name: string }[]
  selected: string | null
  view: CalendarView
  date: string
}) {
  const router = useRouter()
  return (
    <select
      aria-label="Filtrar por quién atiende"
      value={selected ?? ''}
      onChange={(e) => router.push(calendarHref(view, date, e.target.value || null))}
      className="min-h-11 max-w-full rounded-lg border border-border bg-card px-2 text-sm font-medium text-foreground"
    >
      <option value="">{WHOLE_BUSINESS_LABEL}</option>
      {professionals.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name}
        </option>
      ))}
    </select>
  )
}

function MonthView({
  bookings,
  focus,
  timezone,
  now,
  personaId,
  onBookingClick,
}: {
  bookings: TimelineBooking[]
  focus: Date
  timezone: string
  now: Date
  personaId: string | null
  onBookingClick: (b: TimelineBooking) => void
}) {
  // Del mismo reloj, no de un prop aparte: ver `now` en `CalendarViewsProps`.
  const todayKey = localDayKey(now, timezone)
  const monthStart = startOfMonth(focus)
  const monthEnd = endOfMonth(monthStart)
  const days = eachDayOfInterval({
    start: startOfWeek(monthStart, WEEK_STARTS),
    end: endOfWeek(monthEnd, WEEK_STARTS),
  })
  const weekDays = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']

  const dayKeys = days.map((day) => format(day, 'yyyy-MM-dd'))
  const byDay: Record<string, Array<TimelineSegment<TimelineBooking>>> = {}
  for (const segment of segmentItemsByLocalDays(bookings, dayKeys, timezone)) {
    ;(byDay[segment.dayKey] ??= []).push(segment)
  }

  return (
    <div data-slot="calendar-timeline" className="overflow-x-auto">
      <div className="grid min-w-[560px] grid-cols-7 gap-1 md:gap-2">
        {weekDays.map((d) => (
          <div key={d} className="py-1 text-center text-xs font-semibold text-muted-foreground">
            {d}
          </div>
        ))}
        {days.map((day) => {
          const key = format(day, 'yyyy-MM-dd')
          const dayBookings = (byDay[key] || []).filter(
            ({ item }) => item.status !== 'cancelled' && item.status !== 'no_show',
          )
          const inMonth = isSameMonth(day, monthStart)
          const isToday = key === todayKey
          return (
            <div
              key={key}
              data-calendar-day={key}
              className={`relative flex min-h-16 flex-col rounded-lg border p-1.5 transition hover:border-primary/50 md:min-h-24 ${
                inMonth ? 'border-border bg-card' : 'border-transparent bg-muted/30 text-muted-foreground'
              }`}
            >
              <Link
                href={calendarHref('day', key, personaId)}
                className="flex min-h-11 min-w-11 items-center rounded-lg hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring"
                aria-label={`Ver ${format(day, "EEEE d 'de' MMMM", { locale: es })}`}
              >
              <span
                className={`pointer-events-none relative text-xs font-medium ${
                  isToday
                    ? 'flex size-6 items-center justify-center rounded-full bg-primary text-primary-foreground'
                    : ''
                }`}
              >
                {format(day, 'd')}
              </span>
              </Link>
              <div className="relative mt-1 space-y-1">
                {dayBookings.slice(0, 3).map((segment) => {
                  const b = segment.item
                  const appearance = bookingAppearance(b.service?.pastelColor, displayedBookingStatus(b, now))
                  const bookingLabel = `${b.customer?.name || bookingServiceName(b)} — ${localTime(b.startDateTime, timezone)}`
                  return (
                    <button
                      key={`${key}-${b.id}`}
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        onBookingClick(b)
                      }}
                      aria-label={`${bookingLabel}${continuationDescription(segment, timezone)}`}
                      className="flex min-h-11 min-w-11 w-full items-center gap-1 rounded px-1 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1"
                      style={{
                        backgroundColor: appearance.background,
                        color: appearance.textColor,
                        opacity: appearance.opacity,
                      }}
                    >
                      <span
                        className="size-1.5 shrink-0 rounded-full ring-1 ring-white"
                        style={{ backgroundColor: appearance.dotColor }}
                      />
                      <span
                        className="truncate text-xs leading-tight"
                        style={appearance.strikeThrough ? { textDecoration: 'line-through' } : undefined}
                      >
                        {b.customer?.name || bookingServiceName(b)}
                      </span>
                    </button>
                  )
                })}
                {dayBookings.length > 3 && (
                  <Link href={calendarHref('day', key, personaId)} className="flex min-h-11 min-w-11 items-center text-xs text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">+{dayBookings.length - 3} más</Link>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function TimelineView({
  days,
  bookings,
  timeBlocks,
  timezone,
  now,
  personaId,
  onBookingClick,
  onBlockClick,
}: {
  days: Date[]
  bookings: TimelineBooking[]
  timeBlocks: CalendarTimeBlock[]
  timezone: string
  now: Date
  personaId: string | null
  onBookingClick: (b: TimelineBooking) => void
  onBlockClick: (b: CalendarTimeBlock) => void
}) {
  // Del mismo reloj, no de un prop aparte: ver `now` en `CalendarViewsProps`.
  const todayKey = localDayKey(now, timezone)
  const dayKeys = days.map((day) => format(day, 'yyyy-MM-dd'))
  const allItems: CalendarTimelineItem[] = [
    ...bookings.map((value) => ({ kind: 'booking' as const, value, startDateTime: value.startDateTime, endDateTime: value.endDateTime })),
    ...timeBlocks.map((value) => ({ kind: 'block' as const, value, startDateTime: value.startDateTime, endDateTime: value.endDateTime })),
  ]
  const segments = segmentItemsByLocalDays(allItems, dayKeys, timezone)
  const hasClockTransition = dayKeys.some((dayKey) => buildTimelineAxis(dayKey, [], timezone, 0, 24).durationMin !== 24 * 60)
  const sharedRange = computeHourRange(segments.map((segment) => ({
    startDateTime: segment.segmentStart.toISOString(),
    endDateTime: segment.segmentEnd.toISOString(),
  })), timezone)
  const timelineDays = days.map((day) => {
    const dayKey = format(day, 'yyyy-MM-dd')
    const daySegments = segments.filter((segment) => segment.dayKey === dayKey)
    const axis = buildTimelineAxis(
      dayKey,
      daySegments,
      timezone,
      hasClockTransition ? 8 : sharedRange.startHour,
      hasClockTransition ? 20 : sharedRange.endHour,
    )
    const positioned = packSegmentLanes(daySegments, axis.start)
    const laneCount = Math.max(1, ...positioned.map(p => p.lanes))
    return { day, dayKey, positioned, laneCount, axis }
  })

  return (
    <>
      <BriefEventsDisclosure
        days={timelineDays}
        timezone={timezone}
        now={now}
        onBookingClick={onBookingClick}
        onBlockClick={onBlockClick}
      />
      <div className="overflow-x-auto">
        {hasClockTransition ? (
          <div className={`flex min-w-fit gap-3 ${days.length === 1 ? 'w-full' : ''}`}>
            {timelineDays.map((timelineDay) => (
              <div key={timelineDay.dayKey} className={`flex ${days.length === 1 ? 'w-full' : ''}`}>
                <HourAxis axis={timelineDay.axis} />
                <TimelineDayColumn
                  data={timelineDay}
                  todayKey={todayKey}
                  timezone={timezone}
                  now={now}
                  personaId={personaId}
                  totalDays={days.length}
                  onBookingClick={onBookingClick}
                  onBlockClick={onBlockClick}
                />
              </div>
            ))}
          </div>
        ) : (
          <div className="flex min-w-fit">
            <HourAxis axis={timelineDays[0].axis} />
            <div className="flex flex-1">
              {timelineDays.map((timelineDay) => (
                <TimelineDayColumn
                  key={timelineDay.dayKey}
                  data={timelineDay}
                  todayKey={todayKey}
                  timezone={timezone}
                  now={now}
                  personaId={personaId}
                  totalDays={days.length}
                  onBookingClick={onBookingClick}
                  onBlockClick={onBlockClick}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  )
}

type CalendarTimelineItem =
  | { kind: 'booking'; value: TimelineBooking; startDateTime: string; endDateTime: string }
  | { kind: 'block'; value: CalendarTimeBlock; startDateTime: string; endDateTime: string }

type BookingTimelineItem = Extract<CalendarTimelineItem, { kind: 'booking' }>
type BlockTimelineItem = Extract<CalendarTimelineItem, { kind: 'block' }>
type PositionedCalendarItem = PositionedSegment<CalendarTimelineItem>

function isBookingPosition(position: PositionedCalendarItem): position is PositionedSegment<BookingTimelineItem> {
  return position.segment.item.kind === 'booking'
}

function isBlockPosition(position: PositionedCalendarItem): position is PositionedSegment<BlockTimelineItem> {
  return position.segment.item.kind === 'block'
}

type TimelineDayData = {
  day: Date
  dayKey: string
  positioned: PositionedCalendarItem[]
  laneCount: number
  axis: TimelineAxis
}

function HourAxis({ axis }: { axis: TimelineAxis }) {
  const hasOffsetLabels = axis.ticks.some((tick) => tick.label.includes('('))
  return (
    <div className={`${hasOffsetLabels ? 'w-24' : 'w-12'} shrink-0 pt-11`}>
      {axis.ticks.map((tick) => (
        <div key={tick.instant.toISOString()} style={{ height: HOUR_HEIGHT }} className="relative">
          <span data-slot="timeline-tick" className="absolute -top-2 right-1 whitespace-nowrap text-xs text-muted-foreground">
            {tick.label}
          </span>
        </div>
      ))}
    </div>
  )
}

function TimelineDayColumn({
  data,
  todayKey,
  timezone,
  now,
  personaId,
  totalDays,
  onBookingClick,
  onBlockClick,
}: {
  data: TimelineDayData
  todayKey: string
  timezone: string
  now: Date
  personaId: string | null
  totalDays: number
  onBookingClick: (booking: TimelineBooking) => void
  onBlockClick: (block: CalendarTimeBlock) => void
}) {
  const { day, dayKey, positioned, laneCount, axis } = data
  const isToday = dayKey === todayKey
  return (
    <div
      data-calendar-day={dayKey}
      className={`min-w-32 flex-1 border-l border-border ${totalDays > 1 ? '' : 'min-w-0'}`}
      style={{ minWidth: Math.max(128, laneCount * (MIN_LANE_WIDTH + EVENT_GAP) + 2) }}
    >
      <Link
        href={calendarHref('day', dayKey, personaId)}
        className="flex min-h-11 items-center justify-center gap-1.5 border-b border-border text-xs font-medium hover:bg-muted/40"
      >
        <span className="capitalize text-muted-foreground">{format(day, 'EEE', { locale: es })}</span>
        <span className={isToday ? 'flex size-5 items-center justify-center rounded-full bg-primary text-[11px] text-primary-foreground' : 'text-foreground'}>
          {format(day, 'd')}
        </span>
      </Link>
      <div className="relative" style={{ height: axis.durationMin / 60 * HOUR_HEIGHT }}>
        {axis.ticks.map((tick) => (
          <div
            key={tick.instant.toISOString()}
            className="absolute inset-x-0 border-b border-border/40"
            style={{ top: tick.offsetMin / 60 * HOUR_HEIGHT, height: HOUR_HEIGHT }}
          />
        ))}
        {positioned.map((position) => {
          if (isBookingPosition(position)) {
            const booking = position.segment.item.value
            return <BookingBlock
              key={`booking-${dayKey}-${booking.id}`}
              p={position}
              timezone={timezone}
              now={now}
              interactive={!isBriefEvent(position)}
              onClick={() => onBookingClick(booking)}
            />
          }
          if (!isBlockPosition(position)) return null
          const block = position.segment.item.value
          return <BlockBand
            key={`block-${dayKey}-${block.id}`}
            p={position}
            timezone={timezone}
            interactive={!isBriefEvent(position)}
            onClick={() => onBlockClick(block)}
          />
        })}
      </div>
    </div>
  )
}

function eventHeight(p: Pick<PositionedCalendarItem, 'heightMin'>): number {
  return p.heightMin / 60 * HOUR_HEIGHT
}

function isBriefEvent(p: Pick<PositionedCalendarItem, 'heightMin'>): boolean {
  return eventHeight(p) < TARGET_SIZE
}

function BriefEventsDisclosure({
  days,
  timezone,
  now,
  onBookingClick,
  onBlockClick,
}: {
  days: Array<{
    day: Date
    dayKey: string
    positioned: PositionedCalendarItem[]
  }>
  timezone: string
  now: Date
  onBookingClick: (booking: TimelineBooking) => void
  onBlockClick: (block: CalendarTimeBlock) => void
}) {
  const v = useVocabulary()
  const briefDays = days.map(({ day, dayKey, positioned }) => ({
    day,
    dayKey,
    items: positioned.filter(isBriefEvent),
  })).filter(({ items }) => items.length > 0)
  const count = new Set(briefDays.flatMap(({ items }) => items.map((position) => {
    const item = position.segment.item
    return `${item.kind}-${item.value.id}`
  }))).size
  if (count === 0) return null

  return (
    <details data-slot="brief-calendar-events" className="group mb-4 rounded-lg border border-border bg-muted/30">
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-3 py-2 text-sm font-semibold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 [&::-webkit-details-marker]:hidden">
        <span>Citas breves y bloqueos ({count})</span>
        <ChevronDown aria-hidden="true" className="ml-auto size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
      </summary>
      <div className="space-y-4 border-t border-border p-3">
        {briefDays.map(({ day, dayKey, items }) => (
          <section key={dayKey} data-calendar-day={dayKey} aria-label={format(day, "EEEE d 'de' MMMM", { locale: es })}>
            <h4 className="mb-2 text-xs font-semibold capitalize text-muted-foreground">
              {format(day, "EEEE d 'de' MMMM", { locale: es })}
            </h4>
            <ul className="space-y-2">
              {items.map((p) => {
                if (p.segment.item.kind === 'booking') {
                  const booking = p.segment.item.value
                  const status = bookingStatusLabel(displayedBookingStatus(booking, now))
                  const customer = booking.customer?.name || v.Client
                  const professional = booking.professional?.name ? `Atiende: ${booking.professional.name}` : 'Sin persona asignada'
                  const label = `${segmentTimeRange(p.segment, timezone)} · ${customer} · ${bookingServiceName(booking)} · ${professional} · ${status}${continuationDescription(p.segment, timezone)}`
                  return (
                    <li key={`booking-${dayKey}-${booking.id}`}>
                      <button
                        type="button"
                        onClick={() => onBookingClick(booking)}
                        aria-label={`Abrir detalle de ${label}`}
                        className="flex min-h-11 w-full cursor-pointer flex-col justify-center rounded-lg border border-border bg-card px-3 py-2 text-left hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <span className="text-sm font-semibold text-foreground">{segmentTimeRange(p.segment, timezone)} · {customer}</span>
                        <span className="text-xs text-muted-foreground">{bookingServiceName(booking)} · {professional} · {status}{continuationDescription(p.segment, timezone)}</span>
                      </button>
                    </li>
                  )
                }

                const block = p.segment.item.value
                const professional = block.professionalName ? `Atiende: ${block.professionalName}` : 'Todo el negocio'
                const reason = block.reason || 'No disponible'
                const label = `${segmentTimeRange(p.segment, timezone)} · ${reason} · ${professional} · Bloqueo${continuationDescription(p.segment, timezone)}`
                return (
                  <li key={`block-${dayKey}-${block.id}`}>
                    <button
                      type="button"
                      onClick={() => onBlockClick(block)}
                      aria-label={`Abrir ${label}`}
                      className="flex min-h-11 w-full cursor-pointer flex-col justify-center rounded-lg border border-dashed border-border bg-card px-3 py-2 text-left hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <span className="text-sm font-semibold text-foreground">{segmentTimeRange(p.segment, timezone)} · {reason}</span>
                      <span className="text-xs text-muted-foreground">{professional} · Bloqueo{continuationDescription(p.segment, timezone)}</span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </section>
        ))}
      </div>
    </details>
  )
}

function BookingBlock({
  p,
  timezone,
  now,
  interactive,
  onClick,
}: {
  p: PositionedSegment<BookingTimelineItem>
  timezone: string
  /** El reloj del servidor: ver `now` en `CalendarViewsProps`. */
  now: Date
  interactive: boolean
  onClick: () => void
}) {
  const segment = p.segment
  const b = segment.item.value
  const widthPct = 100 / p.lanes
  const leftPct = p.lane * widthPct
  // El chip habla del estado DERIVADO (ver displayedBookingStatus): con el
  // plazo vencido, el naranja de "pendiente de pago" le hace guardar una hora
  // que el cron va a soltar dentro de la hora. Atenuado, no tachado — el
  // porqué está en `booking-appearance`.
  const shownStatus = displayedBookingStatus(b, now)
  const appearance = bookingAppearance(b.service?.pastelColor, shownStatus)
  const Icon = statusIcons[appearance.icon]
  const start = localTime(segment.segmentStart, timezone)
  const timeRange = segmentTimeRange(segment, timezone)
  const strike = appearance.strikeThrough ? 'line-through' : ''
  const v = useVocabulary()
  const statusLabel = bookingStatusLabel(shownStatus)
  const ariaLabel = `${statusLabel} — ${b.customer?.name || v.Client} — ${bookingServiceName(b)}${b.professional?.name ? ` — Atiende: ${b.professional.name}` : ''} — ${timeRange}${continuationDescription(segment, timezone)}`

  const content = (
    <>
      <span
        className="absolute right-0.5 top-0.5 flex size-3 items-center justify-center rounded-full ring-1 ring-white"
        style={{ backgroundColor: appearance.dotColor }}
        aria-hidden="true"
      >
        <Icon className="size-2 text-white" strokeWidth={3} />
      </span>
      <div className={`font-semibold ${strike}`}>{start}</div>
      <div className={`truncate ${strike}`}>{b.customer?.name || v.Client}</div>
      {p.heightMin >= (b.professional ? 75 : 60) && bookingServiceName(b) && <div className="truncate">{bookingServiceName(b)}</div>}
      {p.heightMin >= 60 && b.professional && (
        <div className={`truncate ${strike}`}>{b.professional.name}</div>
      )}
    </>
  )

  const style = {
    top: (p.topMin / 60) * HOUR_HEIGHT,
    height: eventHeight(p),
    left: `calc(${leftPct}% + 2px)`,
    width: `calc(${widthPct}% - 4px)`,
    backgroundColor: appearance.background,
    borderColor: appearance.borderColor,
    color: appearance.textColor,
    opacity: appearance.opacity,
  }

  if (!interactive) {
    return (
      <div
        role="img"
        data-booking-id={b.id}
        aria-label={ariaLabel}
        className="pointer-events-none absolute overflow-hidden rounded-md border px-1.5 text-left text-xs leading-tight"
        style={style}
      >
        {content}
      </div>
    )
  }

  return (
    <button
      type="button"
      data-booking-id={b.id}
      onClick={onClick}
      aria-label={ariaLabel}
      className="absolute cursor-pointer overflow-hidden rounded-md border px-1.5 py-1 text-left text-xs leading-tight transition-colors hover:z-10 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1"
      style={style}
    >
      {content}
    </button>
  )
}

function BlockBand({ p, timezone, interactive, onClick }: { p: PositionedSegment<BlockTimelineItem>; timezone: string; interactive: boolean; onClick: () => void }) {
  const segment = p.segment
  const block = segment.item.value
  const reason = block.reason || 'Bloqueado'
  // El dueño va ADELANTE del motivo porque la banda es angosta y trunca por la derecha:
  // "Ana · Almuer…" sigue diciendo lo importante, "Almuerzo · A…" no. Sin nombre el
  // bloqueo es del negocio y cierra para todos, que es como se leía siempre.
  // "de Ana" en las dos formas del aria-label: con motivo ("Bloqueo de Ana: Almuerzo") y
  // sin motivo ("Bloqueo de horario de Ana"). Sin dueño queda igual que siempre.
  const deQuien = block.professionalName ? ` de ${block.professionalName}` : ''
  const texto = block.professionalName ? `${block.professionalName} · ${reason}` : reason
  const ariaLabel = `${block.reason ? `Bloqueo${deQuien}: ${block.reason}` : `Bloqueo de horario${deQuien}`} — ${segmentTimeRange(segment, timezone)}${continuationDescription(segment, timezone)}`
  const style = {
    top: (p.topMin / 60) * HOUR_HEIGHT,
    height: eventHeight(p),
    left: `calc(${p.lane * 100 / p.lanes}% + 2px)`,
    width: `calc(${100 / p.lanes}% - 4px)`,
  }

  if (!interactive) {
    return (
      <div
        role="img"
        data-time-block-id={block.id}
        aria-label={ariaLabel}
        className="pointer-events-none absolute overflow-hidden rounded-md border border-dashed border-muted-foreground/40 bg-muted px-1.5 text-left text-xs text-muted-foreground"
        style={style}
      >
        {texto}
      </div>
    )
  }

  return (
    <button
      type="button"
      data-time-block-id={block.id}
      onClick={onClick}
      aria-label={ariaLabel}
      className="absolute cursor-pointer overflow-hidden rounded-md border border-dashed border-muted-foreground/40 bg-muted px-1.5 py-1 text-left text-xs text-muted-foreground transition-colors hover:border-muted-foreground/70 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1"
      style={style}
    >
      {texto}
    </button>
  )
}

function localTime(value: string | Date, timezone: string): string {
  // Pequeño helper local para evitar importar date-fns-tz en el cliente solo por esto.
  return new Date(value).toLocaleTimeString('es-CL', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: timezone,
  })
}

function segmentTimeRange(segment: TimelineSegment<{ startDateTime: string; endDateTime: string }>, timezone: string): string {
  return `${localTime(segment.segmentStart, timezone)}–${localTime(segment.segmentEnd, timezone)}`
}

function originalDateTimeRange(item: { startDateTime: string; endDateTime: string }, timezone: string): string {
  const formatValue = (value: string) => formatInTimeZone(new Date(value), timezone, "d MMM HH:mm (xxx)", { locale: es })
  return `${formatValue(item.startDateTime)}–${formatValue(item.endDateTime)}`
}

function continuationDescription<T extends { startDateTime: string; endDateTime: string }>(segment: TimelineSegment<T>, timezone: string): string {
  if (!segment.continuesFromPreviousDay && !segment.continuesToNextDay) return ''
  const direction = segment.continuesFromPreviousDay && segment.continuesToNextDay
    ? 'Continúa desde el día anterior y al día siguiente'
    : segment.continuesFromPreviousDay
      ? 'Continúa desde el día anterior'
      : 'Continúa al día siguiente'
  return ` · ${direction} · Horario completo: ${originalDateTimeRange(segment.item, timezone)}`
}

function bookingSegmentLabel(
  segment: TimelineSegment<TimelineBooking>,
  timezone: string,
  now: Date,
  fallbackCustomer: string,
): string {
  const booking = segment.item
  return `${segmentTimeRange(segment, timezone)} · ${booking.customer?.name || fallbackCustomer} · ${bookingServiceName(booking)} · ${bookingStatusLabel(displayedBookingStatus(booking, now))}${continuationDescription(segment, timezone)}`
}

function blockSegmentLabel(segment: TimelineSegment<CalendarTimeBlock>, timezone: string): string {
  const block = segment.item
  return `${segmentTimeRange(segment, timezone)} · ${block.reason || 'No disponible'} · ${block.professionalName ? `Atiende: ${block.professionalName}` : 'Todo el negocio'} · Bloqueo${continuationDescription(segment, timezone)}`
}
