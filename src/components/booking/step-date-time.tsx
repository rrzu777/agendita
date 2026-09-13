'use client'

import { useEffect, useState } from 'react'
import { addMonths, endOfMonth, format, startOfMonth, eachDayOfInterval } from 'date-fns'
import { es } from 'date-fns/locale'
import { getAvailabilityPreview } from '@/server/actions/availability'
import { getLocalDateStr, localDateTimeToUtc } from '@/lib/availability/timezone'
import { wizardServiceIds } from '@/lib/bookings/wizard-selection'
import { pickCacheKey } from '@/lib/professionals/eligible'
import { formatBookingDateTime } from '@/lib/bookings/format-booking-datetime'
import { Button } from '@/components/ui/button'
import type { BookingData } from './wizard'
import { StepTime } from './step-time'
import { usePublicAnalytics } from '@/components/analytics/public-analytics'

type Preview = Extract<Awaited<ReturnType<typeof getAvailabilityPreview>>, { ok: true }>['data']
export function StepDateTime({ businessId, timezone, data, onDate, onSelect, onBack }: {
  businessId: string; timezone: string; data: BookingData
  onDate: (date: Date | null) => void
  onSelect: (slot: { start: Date; end: Date }) => void
  onBack: () => void
}) {
  const analytics = usePublicAnalytics()
  const [today, setToday] = useState('')
  const [month, setMonth] = useState(() => data.date ? getLocalDateStr(data.date, timezone).slice(0, 7) : '')
  useEffect(() => {
    const localToday = getLocalDateStr(new Date(), timezone)
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initialize the client clock after hydration.
    setToday(localToday)
    setMonth(value => value || localToday.slice(0, 7))
  }, [timezone])
  const monthDate = new Date(`${month}-01T12:00:00`)
  const days = month ? eachDayOfInterval({ start: startOfMonth(monthDate), end: endOfMonth(monthDate) }) : []
  const selection = JSON.stringify(wizardServiceIds(data))
  const key = JSON.stringify([businessId, selection, pickCacheKey(data.professional), data.serviceModality, month])
  const [response, setResponse] = useState<{ key: string; value?: Preview; error?: string } | null>(null)
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    if (!month) return
    let cancelled = false
    const revision = analytics.revision()
    const captureIdentity = analytics.attemptIdentity()
    const queryId = captureIdentity ? crypto.randomUUID() : null
    const requestGeneration = captureIdentity ? analytics.nextAvailabilityGeneration() : null
    const serviceIds = JSON.parse(selection) as string[]
    function observe(result: 'available' | 'empty' | 'error') {
      if (!queryId || requestGeneration === null || analytics.revision() !== revision || analytics.attemptIdentity() !== captureIdentity || !data.serviceId || !data.serviceModality) return
      analytics.track({ type: 'availability_preview_result', data: { serviceId: data.serviceId, ...(serviceIds.length > 1 ? { serviceIds } : {}), modality: data.serviceModality, professional: data.professional.kind === 'person' ? { kind: 'person', professionalId: data.professional.id } : data.professional, localMonth: month, queryId, requestGeneration, result } })
    }
    getAvailabilityPreview({ businessId, serviceIds: JSON.parse(selection), professional: data.professional, modality: data.serviceModality, from: `${month}-01`, days: days.length })
      .then(result => { if (!cancelled) { setResponse(result.ok ? { key, value: result.data } : { key, error: result.error }); observe(result.ok ? result.data.days.some(day => day.count > 0) ? 'available' : 'empty' : 'error') } })
      .catch(() => { if (!cancelled) { setResponse({ key, error: 'No pudimos consultar la disponibilidad. Revisa tu conexión.' }); observe('error') } })
    return () => { cancelled = true }
    // key includes every booking dimension; contacts/consent do not invalidate availability.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, retry, analytics])
  const current = response?.key === key ? response : null
  const preview = current?.value
  const selectedDate = data.date ? getLocalDateStr(data.date, timezone) : null
  const next = preview?.days.find(day => day.firstSlot)?.firstSlot
  if (!today || !month) return <p role="status">Preparando calendario…</p>
  const nextMonth = format(addMonths(monthDate, 1), 'yyyy-MM')
  return <div>
    <h2 className="mb-2 font-heading text-3xl font-semibold text-primary">Elige fecha y hora</h2>
    <p className="mb-5 text-sm text-muted-foreground">Horarios de {data.professionalName || 'este negocio'}. Zona horaria: {timezone}.</p>
    <div className="mb-4 flex items-center justify-between gap-2">
      <Button variant="outline" aria-label="Mes anterior" className="size-11 p-0" disabled={month <= today.slice(0, 7)} onClick={() => setMonth(format(addMonths(monthDate, -1), 'yyyy-MM'))}>‹</Button>
      <h3 className="font-semibold capitalize">{format(monthDate, 'MMMM yyyy', { locale: es })}</h3>
      <Button variant="outline" aria-label="Mes siguiente" className="size-11 p-0" disabled={!preview || nextMonth > preview.windowEnd.slice(0, 7)} onClick={() => setMonth(nextMonth)}>›</Button>
    </div>
    {!current && <p role="status" className="mb-4 text-sm">Consultando días con horas disponibles…</p>}
    {current?.error && <div role="alert" className="mb-4"><p>{current.error}</p><Button variant="outline" className="mt-2 min-h-11" onClick={() => { setResponse(null); setRetry(n => n + 1) }}>Reintentar</Button></div>}
    <div className="mb-4 grid grid-cols-7 gap-1" aria-label="Calendario de disponibilidad">
      {['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'].map(day => <span key={day} className="py-2 text-center text-xs text-muted-foreground">{day}</span>)}
      {Array.from({ length: (monthDate.getDay() + 6) % 7 }, (_, i) => <span key={`blank-${i}`} />)}
      {days.map(day => {
        const date = format(day, 'yyyy-MM-dd')
        const capacity = preview?.days.find(d => d.date === date)
        const outside = date < (preview?.today ?? today) || !!preview && date > preview.windowEnd
        const available = !!capacity?.count && !outside
        const label = `${format(day, 'd MMMM', { locale: es })}: ${outside ? 'fuera del plazo' : !capacity ? 'disponibilidad sin consultar' : available ? `${capacity.count} horarios` : 'sin horas'}`
        return <button key={date} type="button" data-day={date} aria-label={label} aria-pressed={date === selectedDate} disabled={!available} onClick={() => onDate(localDateTimeToUtc(date, '12:00', timezone))} className={`flex min-h-12 flex-col items-center justify-center gap-1 rounded-xl text-sm focus-visible:outline-2 focus-visible:outline-primary ${date === selectedDate ? 'bg-primary text-primary-foreground' : available ? 'bg-secondary/45 hover:bg-secondary' : 'text-muted-foreground/50'}`}>
          {day.getDate()}<span aria-hidden="true" className={`size-1 rounded-full ${available ? 'bg-current' : ''}`} />
        </button>
      })}
    </div>
    <p className="mb-5 text-xs text-muted-foreground">Solo puedes elegir días con horas. La disponibilidad se vuelve a validar al reservar.</p>
    {preview && !next && <p className="mb-5">No hay horas en este mes. {nextMonth <= preview.windowEnd.slice(0, 7) ? 'Revisa el mes siguiente o cambia de profesional.' : 'Prueba con otra selección de servicios o profesional.'}</p>}
    {next && !selectedDate && <button type="button" className="mb-5 w-full rounded-xl border border-border p-4 text-left" onClick={() => onDate(next.start)}><span className="block text-sm text-muted-foreground">Primera hora de este mes</span><span className="font-semibold">{formatBookingDateTime(next.start, timezone)}</span></button>}
    {preview && selectedDate?.startsWith(month) && preview.days.some(d => d.date === selectedDate && d.count > 0) && <StepTime key={`${key}:${selectedDate}`} embedded businessId={businessId} timezone={timezone} data={data} onSelect={onSelect} onBack={() => onDate(null)} />}
    <Button variant="outline" className="mt-5 h-12 rounded-full px-6" onClick={onBack}>Atrás</Button>
  </div>
}
