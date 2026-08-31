'use client'

import { useState, type FormEvent } from 'react'
import { formatInTimeZone } from 'date-fns-tz'
import type { OwnerAnalyticsReport } from '@/server/analytics/reports'
import type { AnalyticsPeriodMode } from './analytics-dashboard'
import { AnalyticsOptionPicker } from './analytics-option-picker'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NativeSelect } from '@/components/ui/native-select'

const channels = { instagram: 'Instagram', facebook: 'Facebook', whatsapp: 'WhatsApp', google: 'Google', referral: 'Referido', direct: 'Directo', other: 'Otro', unknown: 'Desconocido' }
export function AnalyticsControls({ report, periodMode }: { report: OwnerAnalyticsReport; periodMode: AnalyticsPeriodMode }) {
  const [mode, setMode] = useState(periodMode.days ? String(periodMode.days) : 'custom')
  const [filter, setFilter] = useState(report.filter.channel ? 'channel' : report.filter.acquisitionLinkId ? 'acquisitionLinkId' : report.filter.serviceId ? 'serviceId' : '')
  const [value, setValue] = useState(report.filter.channel ?? report.filter.acquisitionLinkId ?? report.filter.serviceId ?? '')
  const [error, setError] = useState<string | null>(null)
  function validate(event: FormEvent<HTMLFormElement>) {
    setError(null)
    if (mode !== 'custom') return
    const values = new FormData(event.currentTarget)
    const from = Date.parse(`${values.get('from')}T00:00:00Z`), to = Date.parse(`${values.get('to')}T00:00:00Z`)
    const today = Date.parse(`${formatInTimeZone(new Date(report.period.cutoffAt), report.period.timezone, 'yyyy-MM-dd')}T00:00:00Z`)
    const day = 86400000
    const message = !Number.isFinite(from) || !Number.isFinite(to) ? 'Completa ambas fechas.' : to <= from ? 'La fecha final debe ser posterior a la inicial; el día final no se incluye.' : to - from > 90 * day || from < today - 90 * day || to > today + day ? 'Selecciona entre 1 y 90 días dentro de los últimos 90 días, como máximo hasta mañana (excluido).' : null
    if (message) { event.preventDefault(); setError(message) }
  }
  return <form action="/dashboard/metricas" method="get" onSubmit={validate} aria-label="Filtros de métricas" className="space-y-4 rounded-xl border border-border bg-card p-4">
    <div className="grid gap-3 sm:grid-cols-3">
      <label className="space-y-2 text-sm font-medium"><span>Período</span><NativeSelect aria-label="Período de métricas" name={mode === 'custom' ? undefined : 'days'} value={mode} onChange={event => setMode(event.target.value)} className="h-10 bg-background">{[7, 28, 90].map(days => <option key={days} value={days}>{days} días</option>)}<option value="custom">Personalizado</option></NativeSelect></label>
      <label className="space-y-2 text-sm font-medium"><span>Desde (incluido)</span><Input type="date" name="from" defaultValue={report.period.from} disabled={mode !== 'custom'} required /></label>
      <label className="space-y-2 text-sm font-medium"><span>Hasta (excluido)</span><Input type="date" name="to" defaultValue={report.period.to} disabled={mode !== 'custom'} required /></label>
    </div>
    <p className="text-xs text-muted-foreground">El día inicial se incluye y el final no. Puedes consultar de 1 a 90 días, dentro de los últimos 90 días.</p>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="space-y-2 text-sm font-medium"><span>Filtro histórico</span><NativeSelect aria-label="Tipo de filtro histórico" value={filter} onChange={event => { setFilter(event.target.value); setValue('') }} className="h-10 bg-background"><option value="">Sin filtro</option><option value="channel">Canal</option><option value="acquisitionLinkId">Enlace</option><option value="serviceId">Servicio</option></NativeSelect></label>
      {filter === 'channel' && <label className="space-y-2 text-sm font-medium"><span>Canal histórico</span><NativeSelect name="channel" aria-label="Canal histórico" value={value} required onChange={event => setValue(event.target.value)} className="h-10 bg-background"><option value="">Selecciona un canal</option>{Object.entries(channels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</NativeSelect></label>}
      {(filter === 'serviceId' || filter === 'acquisitionLinkId') && <AnalyticsOptionPicker key={filter} kind={filter === 'serviceId' ? 'service' : 'link'} name={value ? filter : undefined} label={filter === 'serviceId' ? 'Servicio histórico' : 'Enlace histórico'} value={value} onChange={setValue} />}
    </div>
    <p className="text-xs text-muted-foreground">Un filtro a la vez: canal, enlace o servicio. Cambiar filtros vuelve a la primera página. Reservas atendidas y canjes incluyen todas las reservas del período, sin este filtro.</p>
    <input type="hidden" name="page" value="1" /><input type="hidden" name="pageSize" value={report.services.pageSize} />
    <Button type="submit" disabled={Boolean(filter && !value)}>Aplicar filtros</Button>
  </form>
}
