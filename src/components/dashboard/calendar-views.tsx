'use client'

import { useState } from 'react'
import Link from 'next/link'
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
import {
  localDayKey,
  computeHourRange,
  packLanes,
  type PositionedItem,
} from '@/lib/calendar/timeline'
import { bookingAppearance, type StatusIcon } from '@/lib/calendar/booking-appearance'

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
  /** Hoy en la zona del negocio (yyyy-MM-dd), calculado en el servidor para evitar hydration mismatch */
  todayKey: string
  timezone: string
  businessCurrency: string
  businessAddress: string | null
}

const HOUR_HEIGHT = 56 // px por hora
const WEEK_STARTS = { locale: es, weekStartsOn: 1 } as const

const statusIcons: Record<StatusIcon, typeof Clock> = {
  clock: Clock,
  check: Check,
  x: X,
  dash: Minus,
}

const statusLabels: Record<string, string> = {
  pending_payment: 'Pendiente de pago',
  confirmed: 'Confirmada',
  completed: 'Completada',
  cancelled: 'Cancelada',
  no_show: 'No asistió',
  expired: 'Expirada',
}

function hrefFor(view: CalendarView, date: Date): string {
  return `/dashboard/calendar?view=${view}&date=${format(date, 'yyyy-MM-dd')}`
}

export function CalendarViews({
  bookings,
  timeBlocks,
  view,
  date,
  todayKey,
  timezone,
  businessCurrency,
  businessAddress,
}: CalendarViewsProps) {
  const focus = parseISO(`${date}T12:00:00`)
  const [activeBooking, setActiveBooking] = useState<TimelineBooking | null>(null)
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
    <div className="studio-card p-4 md:p-6">
      {/* Barra de control — apila hasta lg para no apretarse en tablet */}
      <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="icon" asChild>
            <Link href={hrefFor(view, prev)} aria-label="Anterior">
              <ChevronLeft className="size-4" />
            </Link>
          </Button>
          <Button variant="outline" size="sm" asChild>
            <Link href={`/dashboard/calendar?view=${view}&date=${todayKey}`}>Hoy</Link>
          </Button>
          <Button variant="outline" size="icon" asChild>
            <Link href={hrefFor(view, next)} aria-label="Siguiente">
              <ChevronRight className="size-4" />
            </Link>
          </Button>
          <h2 className="ml-1 whitespace-nowrap font-heading text-lg font-semibold capitalize text-primary">
            {periodLabel}
          </h2>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <ViewSwitch view={view} date={date} />
          {view !== 'month' && <BlockTimeModal defaultDate={date} timezone={timezone} />}
        </div>
      </div>

      {view === 'month' && (
        <MonthView
          bookings={bookings}
          focus={focus}
          timezone={timezone}
          todayKey={todayKey}
          onBookingClick={setActiveBooking}
        />
      )}
      {view === 'week' && (
        <TimelineView
          days={eachDayOfInterval({
            start: startOfWeek(focus, WEEK_STARTS),
            end: endOfWeek(focus, WEEK_STARTS),
          })}
          bookings={bookings}
          timeBlocks={timeBlocks}
          timezone={timezone}
          todayKey={todayKey}
          onBookingClick={setActiveBooking}
          onBlockClick={setActiveBlock}
        />
      )}
      {view === 'day' && (
        <TimelineView
          days={[focus]}
          bookings={bookings}
          timeBlocks={timeBlocks}
          timezone={timezone}
          todayKey={todayKey}
          onBookingClick={setActiveBooking}
          onBlockClick={setActiveBlock}
        />
      )}

      {activeBooking && (
        <BookingDrawer
          booking={activeBooking}
          open={!!activeBooking}
          onOpenChange={(o) => !o && setActiveBooking(null)}
          businessCurrency={businessCurrency}
          businessTimezone={timezone}
          businessAddress={businessAddress}
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
    </div>
  )
}

function ViewSwitch({ view, date }: { view: CalendarView; date: string }) {
  const options: Array<{ key: CalendarView; label: string }> = [
    { key: 'day', label: 'Día' },
    { key: 'week', label: 'Semana' },
    { key: 'month', label: 'Mes' },
  ]
  return (
    <div className="inline-flex rounded-lg border border-border bg-muted/40 p-0.5">
      {options.map((o) => (
        <Link
          key={o.key}
          href={`/dashboard/calendar?view=${o.key}&date=${date}`}
          className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
            view === o.key
              ? 'bg-card text-primary shadow-sm'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          {o.label}
        </Link>
      ))}
    </div>
  )
}

function MonthView({
  bookings,
  focus,
  timezone,
  todayKey,
  onBookingClick,
}: {
  bookings: TimelineBooking[]
  focus: Date
  timezone: string
  todayKey: string
  onBookingClick: (b: TimelineBooking) => void
}) {
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
    <div>
      <div className="grid grid-cols-7 gap-1 md:gap-2">
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
                href={hrefFor('day', day)}
                className="absolute inset-0 rounded-lg"
                aria-label={`Ver ${format(day, "EEEE d 'de' MMMM", { locale: es })}`}
              />
              <span
                className={`pointer-events-none relative text-xs font-medium ${
                  isToday
                    ? 'flex size-6 items-center justify-center rounded-full bg-primary text-primary-foreground'
                    : ''
                }`}
              >
                {format(day, 'd')}
              </span>
              <div className="pointer-events-none relative mt-1 space-y-0.5 overflow-hidden">
                {dayBookings.slice(0, 3).map((b) => {
                  const appearance = bookingAppearance(b.service?.pastelColor, b.status)
                  const bookingLabel = `${b.customer?.name || b.service?.name || 'Reserva'} — ${localTime(b.startDateTime, timezone)}`
                  return (
                    <button
                      key={b.id}
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        onBookingClick(b)
                      }}
                      aria-label={bookingLabel}
                      className="pointer-events-auto flex w-full items-center gap-1 rounded px-1 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1"
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
                        className="truncate text-[10px] leading-tight"
                        style={appearance.strikeThrough ? { textDecoration: 'line-through' } : undefined}
                      >
                        {b.customer?.name || b.service?.name || 'Reserva'}
                      </span>
                    </button>
                  )
                })}
                {dayBookings.length > 3 && (
                  <span className="text-[10px] text-muted-foreground">+{dayBookings.length - 3} más</span>
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
  todayKey,
  onBookingClick,
  onBlockClick,
}: {
  days: Date[]
  bookings: TimelineBooking[]
  timeBlocks: CalendarTimeBlock[]
  timezone: string
  todayKey: string
  onBookingClick: (b: TimelineBooking) => void
  onBlockClick: (b: CalendarTimeBlock) => void
}) {
  const allItems = [...bookings, ...timeBlocks]
  const { startHour, endHour } = computeHourRange(allItems, timezone)
  const hours = Array.from({ length: endHour - startHour }, (_, i) => startHour + i)
  const bodyHeight = (endHour - startHour) * HOUR_HEIGHT

  return (
    <div className="overflow-x-auto">
      <div className="flex min-w-fit">
        {/* Eje de horas */}
        <div className="w-12 shrink-0 pt-8">
          {hours.map((h) => (
            <div key={h} style={{ height: HOUR_HEIGHT }} className="relative">
              <span className="absolute -top-2 right-1 text-[11px] text-muted-foreground">
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
            const positioned = packLanes(dayBookings, timezone, startHour)
            const positionedBlocks = packLanes(dayBlocks, timezone, startHour)

            return (
              <div
                key={dayKey}
                className={`min-w-32 flex-1 border-l border-border ${days.length > 1 ? '' : 'min-w-0'}`}
              >
                {/* Cabecera del día */}
                <Link
                  href={hrefFor('day', day)}
                  className="flex h-8 items-center justify-center gap-1.5 border-b border-border text-xs font-medium hover:bg-muted/40"
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
                <div className="relative" style={{ height: bodyHeight }}>
                  {hours.map((h, idx) => (
                    <div
                      key={h}
                      className="absolute inset-x-0 border-b border-border/40"
                      style={{ top: idx * HOUR_HEIGHT, height: HOUR_HEIGHT }}
                    />
                  ))}

                  {/* Bloqueos (bandas grises) */}
                  {positionedBlocks.map((p) => (
                    <BlockBand key={p.item.id} p={p} onClick={() => onBlockClick(p.item)} />
                  ))}

                  {/* Reservas */}
                  {positioned.map((p) => (
                    <BookingBlock
                      key={p.item.id}
                      p={p}
                      timezone={timezone}
                      onClick={() => onBookingClick(p.item)}
                    />
                  ))}
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
  onClick,
}: {
  p: PositionedItem<TimelineBooking>
  timezone: string
  onClick: () => void
}) {
  const b = p.item
  const widthPct = 100 / p.lanes
  const leftPct = p.lane * widthPct
  const appearance = bookingAppearance(b.service?.pastelColor, b.status)
  const Icon = statusIcons[appearance.icon]
  const start = localTime(b.startDateTime, timezone)
  const strike = appearance.strikeThrough ? 'line-through' : ''
  const statusLabel = statusLabels[b.status] ?? 'Reserva'
  const ariaLabel = `${statusLabel} — ${b.customer?.name || 'Cliente'} — ${start}`

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      className="absolute overflow-hidden rounded-md border px-1.5 py-1 text-left text-[11px] leading-tight shadow-sm transition hover:z-10 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1"
      style={{
        top: (p.topMin / 60) * HOUR_HEIGHT,
        height: Math.max((p.heightMin / 60) * HOUR_HEIGHT - 2, 18),
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
      <div className={`truncate ${strike}`}>{b.customer?.name || 'Cliente'}</div>
      {p.heightMin >= 45 && b.service?.name && <div className="truncate">{b.service.name}</div>}
    </button>
  )
}

function BlockBand({ p, onClick }: { p: PositionedItem<CalendarTimeBlock>; onClick: () => void }) {
  const reason = p.item.reason || 'Bloqueado'
  const ariaLabel = p.item.reason ? `Bloqueo: ${p.item.reason}` : 'Bloqueo de horario'
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      className="absolute inset-x-0.5 overflow-hidden rounded-md border border-dashed border-muted-foreground/40 bg-[repeating-linear-gradient(45deg,transparent,transparent_6px,rgba(0,0,0,0.04)_6px,rgba(0,0,0,0.04)_12px)] px-1.5 py-1 text-left text-[10px] text-muted-foreground transition hover:border-muted-foreground/70 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1"
      style={{
        top: (p.topMin / 60) * HOUR_HEIGHT,
        height: Math.max((p.heightMin / 60) * HOUR_HEIGHT - 2, 16),
      }}
    >
      {reason}
    </button>
  )
}

function localTime(iso: string, timezone: string): string {
  // Pequeño helper local para evitar importar date-fns-tz en el cliente solo por esto.
  return new Date(iso).toLocaleTimeString('es-CL', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: timezone,
  })
}
