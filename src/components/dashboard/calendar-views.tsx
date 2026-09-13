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
import { Button } from '@/components/ui/button'
import { ChevronLeft, ChevronRight, Clock, Check, X, Minus } from 'lucide-react'
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
  packLanes,
  type PositionedItem,
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
          <WeekAgenda focus={focus} personaId={selectedProfessionalId} bookings={bookings} timeBlocks={timeBlocks} timezone={timezone} now={now} onBookingClick={openBooking} onBlockClick={setActiveBlock} />
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
          onBlockClick={setActiveBlock}
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
          onBlockClick={setActiveBlock}
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
        />
      ) : (
        <EditBlockDialog
          key={activeBlock.id}
          block={activeBlock}
          timezone={timezone}
          open={!!activeBlock}
          onOpenChange={(o) => !o && setActiveBlock(null)}
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
  const touchesDay = (item: { startDateTime: string; endDateTime: string }, day: string) =>
    localDayKey(new Date(item.startDateTime), timezone) <= day && localDayKey(new Date(new Date(item.endDateTime).getTime() - 1), timezone) >= day
  return (
    <section aria-label="Agenda de la semana" className="divide-y divide-border">
      {days.map((day) => {
        const key = format(day, 'yyyy-MM-dd')
        const entries = [
          ...bookings.filter((booking) => touchesDay(booking, key)).map((booking) => ({ key: `booking-${booking.id}`, start: booking.startDateTime, node: <button type="button" onClick={() => onBookingClick(booking)} className="w-full rounded-lg border border-border bg-card p-3 text-left hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring">
            <span className="block text-sm font-semibold">{localTime(booking.startDateTime, timezone)} · {booking.customer?.name || v.Client}</span>
            <span className="mt-1 block break-words text-sm text-muted-foreground">{bookingServiceName(booking)}</span>
            <span className="mt-1 block text-xs text-muted-foreground">{bookingStatusLabel(displayedBookingStatus(booking, now))}{booking.professional?.name ? ` · ${booking.professional.name}` : ''}</span>
          </button> })),
          ...timeBlocks.filter((block) => touchesDay(block, key)).map((block) => ({ key: `block-${block.id}`, start: block.startDateTime, node: <button type="button" onClick={() => onBlockClick(block)} className="w-full rounded-lg border border-dashed border-border bg-muted p-3 text-left hover:bg-muted/70 focus-visible:ring-2 focus-visible:ring-ring">
            <span className="block text-sm font-semibold">{localTime(block.startDateTime, timezone)} · Bloqueo{block.professionalName ? ` de ${block.professionalName}` : ''}</span>
            <span className="mt-1 block break-words text-sm text-muted-foreground">{block.reason || 'No disponible'}</span>
          </button> })),
        ].sort((a, b) => a.start.localeCompare(b.start))
        return <div key={key} className="py-3 first:pt-0">
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

  const byDay: Record<string, TimelineBooking[]> = {}
  for (const b of bookings) {
    const key = localDayKey(new Date(b.startDateTime), timezone)
    ;(byDay[key] ??= []).push(b)
  }

  return (
    <div className="overflow-x-auto">
      <div className="grid min-w-[560px] grid-cols-7 gap-1 md:gap-2">
        {weekDays.map((d) => (
          <div key={d} className="py-1 text-center text-xs font-semibold text-muted-foreground">
            {d}
          </div>
        ))}
        {days.map((day) => {
          const key = format(day, 'yyyy-MM-dd')
          const dayBookings = (byDay[key] || []).filter(
            (b) => b.status !== 'cancelled' && b.status !== 'no_show',
          )
          const inMonth = isSameMonth(day, monthStart)
          const isToday = key === todayKey
          return (
            <div
              key={key}
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
                {dayBookings.slice(0, 3).map((b) => {
                  const appearance = bookingAppearance(b.service?.pastelColor, displayedBookingStatus(b, now))
                  const bookingLabel = `${b.customer?.name || bookingServiceName(b)} — ${localTime(b.startDateTime, timezone)}`
                  return (
                    <button
                      key={b.id}
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        onBookingClick(b)
                      }}
                      aria-label={bookingLabel}
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
  const allItems = [...bookings, ...timeBlocks]
  const { startHour, endHour } = computeHourRange(allItems, timezone)
  const hours = Array.from({ length: endHour - startHour }, (_, i) => startHour + i)
  const bodyHeight = (endHour - startHour) * HOUR_HEIGHT

  return (
    <div className="overflow-x-auto">
      <div className="flex min-w-fit">
        {/* Eje de horas */}
        <div className="w-12 shrink-0 pt-11">
          {hours.map((h) => (
            <div key={h} style={{ height: HOUR_HEIGHT }} className="relative">
              <span className="absolute -top-2 right-1 text-xs text-muted-foreground">
                {String(h).padStart(2, '0')}:00
              </span>
            </div>
          ))}
        </div>

        {/* Columnas de días */}
        <div className="flex flex-1">
          {days.map((day) => {
            const dayKey = format(day, 'yyyy-MM-dd')
            const isToday = dayKey === todayKey
            const dayBookings = bookings.filter((b) => localDayKey(new Date(b.startDateTime), timezone) === dayKey)
            const dayBlocks = timeBlocks.filter((tb) => localDayKey(new Date(tb.startDateTime), timezone) === dayKey)
            // Pack the actual hit areas together, including blocks. Enlarging only
            // the CSS height or packing each type separately makes controls overlap.
            // The original item timestamps are retained for every action/dialog.
            const positioned = packLanes([
              ...dayBookings.map(item => ({ ...item, kind: 'booking' as const })),
              ...dayBlocks.map(item => ({ ...item, kind: 'block' as const })),
            ], timezone, startHour, (TARGET_SIZE + 2) * 60 / HOUR_HEIGHT)
            const laneCount = Math.max(1, ...positioned.map(p => p.lanes))
            const dayHeight = Math.max(bodyHeight, ...positioned.map(p => (p.topMin + p.heightMin) / 60 * HOUR_HEIGHT))

            return (
              <div
                key={dayKey}
                className={`min-w-32 flex-1 border-l border-border ${days.length > 1 ? '' : 'min-w-0'}`}
                style={{ minWidth: Math.max(128, laneCount * (MIN_LANE_WIDTH + EVENT_GAP) + 2) }}
              >
                {/* Cabecera del día */}
                <Link
                  href={calendarHref('day', dayKey, personaId)}
                  className="flex min-h-11 items-center justify-center gap-1.5 border-b border-border text-xs font-medium hover:bg-muted/40"
                >
                  <span className="capitalize text-muted-foreground">{format(day, 'EEE', { locale: es })}</span>
                  <span
                    className={
                      isToday
                        ? 'flex size-5 items-center justify-center rounded-full bg-primary text-[11px] text-primary-foreground'
                        : 'text-foreground'
                    }
                  >
                    {format(day, 'd')}
                  </span>
                </Link>

                {/* Cuerpo con líneas de hora + bloques */}
                <div className="relative" style={{ height: dayHeight }}>
                  {hours.map((h, idx) => (
                    <div
                      key={h}
                      className="absolute inset-x-0 border-b border-border/40"
                      style={{ top: idx * HOUR_HEIGHT, height: HOUR_HEIGHT }}
                    />
                  ))}

                  {positioned.map((p) => p.item.kind === 'booking' ? (
                    <BookingBlock
                      key={`booking-${p.item.id}`}
                      p={{ ...p, item: p.item }}
                      timezone={timezone}
                      now={now}
                      onClick={() => onBookingClick(dayBookings.find(b => b.id === p.item.id)!)}
                    />
                  ) : <BlockBand key={`block-${p.item.id}`} p={{ ...p, item: p.item }} onClick={() => onBlockClick(dayBlocks.find(b => b.id === p.item.id)!)} />)}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function BookingBlock({
  p,
  timezone,
  now,
  onClick,
}: {
  p: PositionedItem<TimelineBooking>
  timezone: string
  /** El reloj del servidor: ver `now` en `CalendarViewsProps`. */
  now: Date
  onClick: () => void
}) {
  const b = p.item
  const widthPct = 100 / p.lanes
  const leftPct = p.lane * widthPct
  // El chip habla del estado DERIVADO (ver displayedBookingStatus): con el
  // plazo vencido, el naranja de "pendiente de pago" le hace guardar una hora
  // que el cron va a soltar dentro de la hora. Atenuado, no tachado — el
  // porqué está en `booking-appearance`.
  const shownStatus = displayedBookingStatus(b, now)
  const appearance = bookingAppearance(b.service?.pastelColor, shownStatus)
  const Icon = statusIcons[appearance.icon]
  const start = localTime(b.startDateTime, timezone)
  const strike = appearance.strikeThrough ? 'line-through' : ''
  const v = useVocabulary()
  const statusLabel = bookingStatusLabel(shownStatus)
  const ariaLabel = `${statusLabel} — ${b.customer?.name || v.Client} — ${start}`

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      className="absolute overflow-hidden rounded-md border px-1.5 py-1 text-left text-xs leading-tight transition-colors hover:z-10 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1"
      style={{
        top: (p.topMin / 60) * HOUR_HEIGHT,
        height: Math.max((p.heightMin / 60) * HOUR_HEIGHT - 2, TARGET_SIZE),
        left: `calc(${leftPct}% + 2px)`,
        width: `calc(${widthPct}% - 4px)`,
        backgroundColor: appearance.background,
        borderColor: appearance.borderColor,
        color: appearance.textColor,
        opacity: appearance.opacity,
      }}
    >
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
      {/* Quién atiende, si el chip tiene alto para una línea más. Con el filtro
          en "todo el equipo" es lo que distingue dos citas a la misma hora. */}
      {p.heightMin >= 60 && b.professional && (
        <div className={`truncate ${strike}`}>{b.professional.name}</div>
      )}
    </button>
  )
}

function BlockBand({ p, onClick }: { p: PositionedItem<CalendarTimeBlock>; onClick: () => void }) {
  const reason = p.item.reason || 'Bloqueado'
  // El dueño va ADELANTE del motivo porque la banda es angosta y trunca por la derecha:
  // "Ana · Almuer…" sigue diciendo lo importante, "Almuerzo · A…" no. Sin nombre el
  // bloqueo es del negocio y cierra para todos, que es como se leía siempre.
  // "de Ana" en las dos formas del aria-label: con motivo ("Bloqueo de Ana: Almuerzo") y
  // sin motivo ("Bloqueo de horario de Ana"). Sin dueño queda igual que siempre.
  const deQuien = p.item.professionalName ? ` de ${p.item.professionalName}` : ''
  const texto = p.item.professionalName ? `${p.item.professionalName} · ${reason}` : reason
  const ariaLabel = p.item.reason ? `Bloqueo${deQuien}: ${p.item.reason}` : `Bloqueo de horario${deQuien}`
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      className="absolute overflow-hidden rounded-md border border-dashed border-muted-foreground/40 bg-muted px-1.5 py-1 text-left text-xs text-muted-foreground transition-colors hover:border-muted-foreground/70 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1"
      style={{
        top: (p.topMin / 60) * HOUR_HEIGHT,
        height: Math.max((p.heightMin / 60) * HOUR_HEIGHT - 2, TARGET_SIZE),
        left: `calc(${p.lane * 100 / p.lanes}% + 2px)`,
        width: `calc(${100 / p.lanes}% - 4px)`,
      }}
    >
      {texto}
    </button>
  )
}

function localTime(iso: string, timezone: string): string {
  // Pequeño helper local para evitar importar date-fns-tz en el cliente solo por esto.
  return new Date(iso).toLocaleTimeString('es-CL', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: timezone,
  })
}
