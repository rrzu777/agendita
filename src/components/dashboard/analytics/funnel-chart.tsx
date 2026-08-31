import type { OwnerAnalyticsReport } from '@/server/analytics/reports'

const labels: Record<string, string> = {
  started: 'Inicio', service: 'Servicio', professional: 'Profesional (opcional)', date: 'Fecha', time: 'Hora', customer: 'Datos de reserva', payment: 'Pago', submit: 'Envío',
}
const milestoneOrder = ['started', 'service', 'professional', 'date', 'time', 'customer', 'payment', 'submit']

export function FunnelChart({ funnel, complete, unavailable }: { funnel: OwnerAnalyticsReport['funnel']; complete: OwnerAnalyticsReport['complete']; unavailable: boolean }) {
  if (unavailable) return <p className="rounded-lg bg-secondary/50 p-4 text-sm text-muted-foreground">Datos no disponibles para el recorrido observado.</p>
  const observed = funnel.filter((row) => row.population === 'complete_attempts').sort((a, b) => {
    const aIndex = milestoneOrder.indexOf(a.milestone)
    const bIndex = milestoneOrder.indexOf(b.milestone)
    return (aIndex === -1 ? Number.MAX_SAFE_INTEGER : aIndex) - (bIndex === -1 ? Number.MAX_SAFE_INTEGER : bIndex)
  })
  const steps = [...observed, { milestone: 'verified', count: complete.pathComplete }]
  const max = Math.max(...steps.map((step) => step.count), 1)

  return (
    <div className="space-y-3">
      <ol className="space-y-2" aria-label="Recorrido observado">
        {steps.map((step, index) => (
          <li key={step.milestone} className="grid grid-cols-[1.5rem_minmax(6rem,1fr)_3rem] items-center gap-3 text-sm">
            <span className="flex size-6 items-center justify-center rounded-full bg-secondary font-mono text-xs font-semibold text-primary">{index + 1}</span>
            <span className="min-w-0">
              <span className="block font-medium text-primary">{step.milestone === 'verified' ? 'Reserva verificada con recorrido completo' : labels[step.milestone] ?? step.milestone}</span>
              <span className="mt-1 block h-2 overflow-hidden rounded-full bg-secondary/70"><span className="block h-full rounded-full bg-primary" style={{ width: `${(step.count / max) * 100}%` }} /></span>
            </span>
            <span className="font-mono tabular-nums text-muted-foreground">{step.count}</span>
          </li>
        ))}
      </ol>
      {observed.length === 0 && <p className="text-sm text-muted-foreground">Todavía no hay pasos observados para este período.</p>}
      <p className="rounded-lg border border-border bg-secondary/25 p-3 text-sm text-muted-foreground"><span className="font-semibold text-primary">Recorrido incompleto:</span> {complete.pathIncomplete} {complete.pathIncomplete === 1 ? 'conversión' : 'conversiones'} con reserva válida sin una secuencia completa registrada. Se mantienen en la conversión general.</p>
    </div>
  )
}
