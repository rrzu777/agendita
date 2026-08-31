import Link from 'next/link'
import { ArrowRight, CircleAlert, CreditCard, Eye, Gauge, Waypoints } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { MetricCard } from './metric-card'
import { TrendChart } from './trend-chart'
import { FunnelChart } from './funnel-chart'
import { AnalyticsTables } from './analytics-tables'
import { AcquisitionLinks } from './acquisition-links'
import type { OwnerAnalyticsReport } from '@/server/analytics/reports'

function ratioText(value: { numerator: number; denominator: number; rate: number | null }) {
  return value.rate === null ? 'Sin datos' : `${Math.round(value.rate * 100)}%`
}

function ratioDetail(value: { numerator: number; denominator: number; rate: number | null }, subject: string) {
  return value.rate === null ? `Sin datos para ${subject}` : `${ratioText(value)} · ${value.numerator} de ${value.denominator} ${subject}`
}

const bookingStatusLabels: Record<string, string> = {
  pending_confirmation: 'Pendiente de confirmación',
  pending_payment: 'Pendiente de pago',
  confirmed: 'Confirmada',
  cancelled: 'Cancelada',
  completed: 'Completada',
  no_show: 'No asistió',
  hold_expired: 'Reserva vencida',
  refunded: 'Reembolsada',
}

const redemptionStatusLabels: Record<string, string> = {
  applied: 'Aplicado',
  released: 'Liberado',
}

const lastStepLabels: Record<string, string> = {
  started: 'Inicio',
  service: 'Servicio',
  professional: 'Profesional (opcional)',
  date: 'Fecha',
  time: 'Hora',
  customer: 'Datos de reserva',
  payment: 'Pago',
  submit: 'Envío',
}

function coverageText(report: OwnerAnalyticsReport) {
  if (report.coverage.status === 'unavailable') return 'Datos no disponibles: no se puede confirmar una serie madura para este período.'
  if (report.coverage.status === 'disabled') return 'La captura estuvo deshabilitada durante este período; los espacios sin registro no equivalen a cero.'
  if (report.coverage.status === 'partial') return 'Cobertura parcial: interpreta cada cohorte marcada con cautela.'
  return 'Cobertura completa para las cohortes maduras disponibles.'
}

export function AnalyticsDashboard({ report }: { report: OwnerAnalyticsReport }) {
  const unavailable = report.coverage.status === 'unavailable'
  const hasClosedData = !unavailable && (report.complete.attempts > 0 || report.partial.attempts > 0 || report.visits > 0)
  const hasApplicableRecent = report.recent.status === 'provisional' && report.recent.from < report.recent.to
  const currentStates = report.currentBookings.counts.map((row) => `${bookingStatusLabels[row.status] ?? row.status}: ${row.count}`).join(' · ') || 'Sin estados en este período.'

  return (
    <div className="space-y-8 p-5 pb-24 md:p-10">
      <div className="flex flex-col gap-4 rounded-xl border border-border bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0"><p className="text-sm font-semibold text-primary">{coverageText(report)}</p><p className="mt-1 text-xs text-muted-foreground">Corte: {new Date(report.period.cutoffAt).toLocaleString('es-CL')} · Activación: {report.capture.activatedAt ? new Date(report.capture.activatedAt).toLocaleDateString('es-CL') : 'sin activación registrada'} · Retención vigente: 90 días.</p></div>
        <div className="flex flex-wrap gap-2" aria-label="Seleccionar período"><Button asChild variant="outline" size="sm"><Link href="/dashboard/metricas?days=7">7 días</Link></Button><Button asChild variant="outline" size="sm"><Link href="/dashboard/metricas?days=28">28 días</Link></Button><Button asChild variant="outline" size="sm"><Link href="/dashboard/metricas?days=90">90 días</Link></Button></div>
      </div>
      {report.coverage.warnings.length > 0 && <ul className="rounded-xl border border-border bg-secondary/25 p-4 text-sm text-muted-foreground" aria-label="Advertencias de cobertura">{report.coverage.warnings.map((warning) => <li key={warning}>• {warning}</li>)}</ul>}

      {unavailable ? <Card className="border-destructive/30"><CardHeader><CardTitle className="flex items-center gap-2"><CircleAlert className="size-5 text-destructive" />Datos no disponibles</CardTitle><CardDescription>Este error no se presenta como una serie de ceros. Intenta recargar o acorta el período.</CardDescription></CardHeader></Card> : !hasClosedData ? <Card><CardHeader><CardTitle>Aún no hay datos maduros</CardTitle><CardDescription>La captura puede estar inactiva, sin consentimiento o las ventanas de conversión aún están en curso. No se inventan valores para completar el gráfico.</CardDescription></CardHeader></Card> : <>
        <section aria-label="Resumen de métricas" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard label="Visitas" value={String(report.visits)} detail={ratioDetail(report.visitToAttempt, 'visitas llegan a intento')} />
          <MetricCard label="Intentos completos" value={String(report.complete.attempts)} detail="Medidos desde el primer paso" />
          <MetricCard label="Conversión en 24 h" value={ratioText(report.complete.conversion)} detail={`${report.complete.conversion.numerator} de ${report.complete.conversion.denominator} intentos`} />
          <MetricCard label="Reservas creadas" value={String(report.complete.bookingsCreated)} detail="Puede haber más de una por conversión" />
        </section>

        <section className="grid gap-6 xl:grid-cols-[1.25fr_0.75fr]"><Card><CardHeader><CardTitle>Tendencia</CardTitle><CardDescription>Días maduros; no incluye el período reciente en curso.</CardDescription></CardHeader><CardContent><TrendChart trend={report.trend} unavailable={false} /></CardContent></Card><Card><CardHeader><CardTitle>Entrada y madurez</CardTitle><CardDescription>Completa = desde el primer paso. Parcial = comenzó con consentimiento o restauración a mitad de flujo.</CardDescription></CardHeader><CardContent className="space-y-3 text-sm"><p><span className="font-mono font-semibold tabular-nums text-primary">{report.complete.attempts}</span> intentos completos</p><p><span className="font-mono font-semibold tabular-nums text-primary">{report.partial.attempts}</span> intentos parciales</p><p className="rounded-lg bg-secondary/40 p-3 text-muted-foreground">Comparación: {report.comparison.status === 'comparable' && report.comparison.deltaPercentagePoints !== null ? `${report.comparison.deltaPercentagePoints > 0 ? '+' : ''}${report.comparison.deltaPercentagePoints} puntos porcentuales` : 'no comparable por cobertura o falta de datos.'}</p></CardContent></Card></section>

        <section className="grid gap-6 xl:grid-cols-2"><Card><CardHeader><CardTitle className="flex items-center gap-2"><Waypoints className="size-5" />Recorrido observado</CardTitle><CardDescription>Profesional es opcional: no se usa como requisito entre servicio y fecha.</CardDescription></CardHeader><CardContent><FunnelChart funnel={report.funnel} complete={report.complete} unavailable={false} /></CardContent></Card><Card><CardHeader><CardTitle>Último paso observado</CardTitle><CardDescription>Estos recuentos describen dónde terminó la medición, no la causa de una reserva.</CardDescription></CardHeader><CardContent><ul className="space-y-2">{report.quality.map((row) => <li key={`${row.population}-${row.lastStep}`} className="flex justify-between gap-4 rounded-lg bg-secondary/30 px-3 py-2 text-sm"><span>{lastStepLabels[row.lastStep] ?? row.lastStep}</span><span className="font-mono tabular-nums">{row.count}</span></li>)}</ul></CardContent></Card></section>

        <AnalyticsTables report={report} />

        <section className="grid gap-6 xl:grid-cols-2"><Card><CardHeader><CardTitle>Origen y canjes</CardTitle><CardDescription>Bloques independientes; no combinan origen con servicios ni promociones.</CardDescription></CardHeader><CardContent className="space-y-4 text-sm"><div><h3 className="font-medium text-primary">Canales observados</h3>{report.channels.rows.length === 0 ? <p className="text-muted-foreground">Sin canales observados.</p> : <ul className="mt-2 space-y-1">{report.channels.rows.map((channel) => <li key={channel.id} className="flex justify-between gap-3"><span>{channel.id}</span><span className="font-mono tabular-nums">{ratioDetail(channel.summary.complete.conversion, 'intentos')}</span></li>)}</ul>}</div><div><h3 className="font-medium text-primary">Enlaces agregados</h3>{report.links.rows.length === 0 ? <p className="text-muted-foreground">Sin enlaces con tráfico agregado.</p> : <ul className="mt-2 space-y-1">{report.links.rows.map((link) => <li key={link.id} className="flex justify-between gap-3"><span>{link.label}</span><span className="font-mono tabular-nums">{ratioDetail(link.summary.complete.conversion, 'intentos')}</span></li>)}</ul>}</div><div><h3 className="font-medium text-primary">{report.redemptions.label}</h3>{report.redemptions.rows.length === 0 ? <p className="text-muted-foreground">Sin canjes registrados.</p> : <ul className="mt-2 space-y-1">{report.redemptions.rows.map((redemption) => <li key={`${redemption.promotionId}-${redemption.status}`} className="flex justify-between gap-3"><span>{redemption.label}</span><span>{redemptionStatusLabels[redemption.status] ?? redemption.status} · <span className="font-mono tabular-nums">{redemption.count}</span></span></li>)}</ul>}</div><Link href="/dashboard/promociones" className="inline-flex items-center gap-1 font-medium text-primary underline-offset-4 hover:underline">Ver promociones <ArrowRight className="size-4" /></Link></CardContent></Card><Card><CardHeader><CardTitle>Estados actuales de reservas</CardTitle><CardDescription>{report.currentBookings.label}; no se compara como tendencia porque mide otro momento.</CardDescription></CardHeader><CardContent className="space-y-3 text-sm"><p>{currentStates}</p><p>Cola de aprobación vencida: <span className="font-mono tabular-nums font-semibold text-primary">{report.currentBookings.overdueApproval.lowerBound ? 'al menos ' : ''}{report.currentBookings.overdueApproval.count}</span></p><Link href="/dashboard/bookings" className="inline-flex items-center gap-1 font-medium text-primary underline-offset-4 hover:underline">Revisar reservas <ArrowRight className="size-4" /></Link></CardContent></Card></section>

        <section><div className="mb-3"><h2 className="font-heading text-2xl font-semibold text-primary">Oportunidades para revisar</h2><p className="text-sm text-muted-foreground">{report.opportunityNote}</p></div>{report.opportunities.length === 0 ? <Card><CardContent className="py-4 text-sm text-muted-foreground">No hay señales que superen los umbrales observados; eso no prueba ausencia de oportunidades.</CardContent></Card> : <div className="grid gap-3 md:grid-cols-3">{report.opportunities.map((opportunity) => <Card key={opportunity.key}><CardHeader><CardTitle className="text-base">{opportunity.key === 'overdue_approval' ? 'Aprobaciones vencidas' : 'Disponibilidad observada'}</CardTitle><CardDescription>{opportunity.message}</CardDescription></CardHeader><CardContent><Button asChild size="sm" variant="outline"><Link href={opportunity.href}>Revisar <ArrowRight data-icon="inline-end" /></Link></Button></CardContent></Card>)}</div>}</section>
      </>}

      {hasApplicableRecent ? <Card className="border-secondary"><CardHeader><CardTitle className="flex items-center gap-2"><Gauge className="size-5" />Período reciente en curso</CardTitle><CardDescription>{report.recent.from} a {report.recent.to}; {report.recent.inProgress.complete} completo(s) y {report.recent.inProgress.partial} parcial(es) aún no entran al denominador maduro.</CardDescription></CardHeader></Card> : report.recent.status === 'provisional' ? <Card className="border-secondary"><CardHeader><CardTitle>No hay días recientes aplicables</CardTitle><CardDescription>El rango seleccionado ya está cerrado; no se mezclan proyecciones recientes con este histórico.</CardDescription></CardHeader></Card> : <Card className="border-secondary"><CardHeader><CardTitle>Datos recientes no disponibles</CardTitle><CardDescription>La proyección provisional no se representa como ceros.</CardDescription></CardHeader></Card>}
      <Card><CardHeader><CardTitle className="flex items-center gap-2"><Eye className="size-5" />Privacidad y alcance</CardTitle><CardDescription>{report.suppression.note} El panel no muestra personas únicas, eventos crudos ni datos de clientes.</CardDescription></CardHeader><CardContent><Link href="/dashboard/payments" className="inline-flex items-center gap-1 text-sm font-medium text-primary underline-offset-4 hover:underline"><CreditCard className="size-4" />Ver pagos registrados</Link></CardContent></Card>
      <AcquisitionLinks links={report.acquisitionLinks} />
    </div>
  )
}
