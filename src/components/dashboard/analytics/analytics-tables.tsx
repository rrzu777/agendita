'use client'

import type { KeyboardEvent } from 'react'
import type { OwnerAnalyticsReport } from '@/server/analytics/reports'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
export type AnalyticsPagination = { label: string; previousHref: string | null; nextHref: string | null }
const tableClassName = 'w-full min-w-[38rem] caption-bottom text-sm'
const headClassName = 'h-10 border-b bg-secondary/35 px-2 text-left align-middle font-medium whitespace-nowrap text-foreground'
const cellClassName = 'border-b p-2 align-middle whitespace-nowrap'

function populationLabel(population: OwnerAnalyticsReport['services']['rows'][number]['population']) {
  return population === 'complete_attempts' ? 'Entrada completa' : population === 'partial_attempts' ? 'Entrada parcial' : population
}

function rate(value: { numerator: number; denominator: number; rate: number | null }) {
  return value.rate === null ? 'Sin datos' : `${Math.round(value.rate * 100)}% (${value.numerator}/${value.denominator})`
}

function scrollWithArrowKeys(event: KeyboardEvent<HTMLDivElement>) {
  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
  event.preventDefault()
  event.currentTarget.scrollBy({ left: event.key === 'ArrowRight' ? 160 : -160 })
}

export function AnalyticsTables({ report, pagination }: { report: OwnerAnalyticsReport; pagination: AnalyticsPagination }) {
  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <section className="min-w-0 space-y-3">
        <div><h2 className="font-heading text-xl font-semibold text-primary">Tendencia diaria</h2><p className="text-sm text-muted-foreground">Cohortes maduras por fecha local.</p></div>
        <div tabIndex={0} onKeyDown={scrollWithArrowKeys} aria-label="Desplazar tendencia diaria horizontalmente" className="overflow-x-auto rounded-xl ring-1 ring-border/60 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
          <table aria-label="Tendencia diaria" className={tableClassName}>
            <thead><tr><th className={headClassName}>Fecha local</th><th className={headClassName}>Visitas</th><th className={headClassName}>Intentos completos</th><th className={headClassName}>Conversión completa</th><th className={headClassName}>Intentos parciales</th></tr></thead>
            <tbody>{report.trend.map((day) => <tr key={`${day.date}-${day.timezone}`} className="hover:bg-muted/50"><td className={cellClassName}>{day.date} <span className="text-xs text-muted-foreground">({day.timezone})</span></td><td className={`${cellClassName} font-mono tabular-nums`}>{day.visits}</td><td className={`${cellClassName} font-mono tabular-nums`}>{day.complete.attempts}</td><td className={cellClassName}>{rate(day.complete.conversion)}</td><td className={`${cellClassName} font-mono tabular-nums`}>{day.partial.attempts}</td></tr>)}</tbody>
          </table>
        </div>
        <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground"><span>{pagination.label}</span>{pagination.previousHref && <Button asChild size="sm" variant="outline"><Link href={pagination.previousHref}>Anterior</Link></Button>}{pagination.nextHref && <Button asChild size="sm" variant="outline"><Link href={pagination.nextHref}>Siguiente servicios</Link></Button>}</div>
      </section>
      <section className="min-w-0 space-y-3">
        <div><h2 className="font-heading text-xl font-semibold text-primary">Servicios observados</h2><p className="text-sm text-muted-foreground">Grano independiente: no cruza canales ni enlaces.</p></div>
        <div tabIndex={0} onKeyDown={scrollWithArrowKeys} aria-label="Desplazar servicios observados horizontalmente" className="overflow-x-auto rounded-xl ring-1 ring-border/60 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
          <table aria-label="Servicios observados" className={tableClassName}>
            <thead><tr><th className={headClassName}>Servicio</th><th className={headClassName}>Interés</th><th className={headClassName}>Seleccionados</th><th className={headClassName}>Conversión</th><th className={headClassName}>Sin recorrido</th></tr></thead>
            <tbody>{report.services.rows.map((service) => <tr key={`${service.population}-${service.id}`} className="hover:bg-muted/50"><td className={`${cellClassName} font-medium text-primary`}><span className="block">{service.label}</span><span className="block text-xs font-normal text-muted-foreground">{populationLabel(service.population)}</span></td><td className={`${cellClassName} font-mono tabular-nums`}>{service.interest}</td><td className={`${cellClassName} font-mono tabular-nums`}>{service.selected}</td><td className={cellClassName}>{rate(service.conversion)}</td><td className={`${cellClassName} font-mono tabular-nums`}>{service.unobservedConversions}</td></tr>)}</tbody>
          </table>
        </div>
      </section>
      <section className="min-w-0 space-y-3 xl:col-span-2"><div><h2 className="font-heading text-xl font-semibold text-primary">Cobertura por cohorte</h2><p className="text-sm text-muted-foreground">Fecha y zona conservan su identidad; una cohorte no disponible interrumpe la tendencia.</p></div><div className="overflow-x-auto rounded-xl ring-1 ring-border/60"><table className={tableClassName}><thead><tr><th className={headClassName}>Fecha local</th><th className={headClassName}>Zona</th><th className={headClassName}>Cobertura</th><th className={headClassName}>Estado</th></tr></thead><tbody>{report.coverage.cohorts.map(c => <tr key={`${c.date}-${c.timezone}-${c.version}`}><td className={cellClassName}>{c.date}</td><td className={cellClassName}>{c.timezone}</td><td className={cellClassName}>{c.coverage}</td><td className={cellClassName}>{c.state === 'unavailable' ? 'No disponible' : c.state}</td></tr>)}</tbody></table></div></section>
    </div>
  )
}
