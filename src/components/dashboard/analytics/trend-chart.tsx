import type { OwnerAnalyticsReport } from '@/server/analytics/reports'

function percent(value: number, max: number) {
  return max === 0 ? 100 : 100 - (value / max) * 76 - 12
}

export function TrendChart({ trend, unavailable }: { trend: OwnerAnalyticsReport['trend']; unavailable: boolean }) {
  if (unavailable) return <p className="rounded-lg bg-secondary/50 p-4 text-sm text-muted-foreground">Datos no disponibles para dibujar una tendencia fiable.</p>
  if (trend.length === 0) return <p className="rounded-lg bg-secondary/50 p-4 text-sm text-muted-foreground">Aún no hay días observados en este período.</p>

  const max = Math.max(1, ...trend.map((day) => day.complete.attempts))
  const points = trend.map((day, index) => `${trend.length === 1 ? 50 : 4 + (index / (trend.length - 1)) * 92},${percent(day.complete.attempts, max)}`).join(' ')

  return (
    <figure aria-labelledby="trend-title" className="space-y-3">
      <svg viewBox="0 0 100 100" role="img" aria-label="Tendencia visual de intentos completos" className="h-40 w-full rounded-lg bg-secondary/30 p-3" preserveAspectRatio="none">
        <line x1="4" x2="96" y1="88" y2="88" stroke="currentColor" strokeOpacity=".25" vectorEffect="non-scaling-stroke" />
        <polyline points={points} fill="none" stroke="currentColor" strokeWidth="2" vectorEffect="non-scaling-stroke" className="text-primary" />
        {trend.map((day, index) => {
          const x = trend.length === 1 ? 50 : 4 + (index / (trend.length - 1)) * 92
          const y = percent(day.complete.attempts, max)
          return <circle key={`${day.date}-${day.timezone}`} cx={x} cy={y} r="2" fill="currentColor" className="text-primary" />
        })}
      </svg>
      <figcaption id="trend-title" className="text-xs text-muted-foreground">Intentos completos maduros por día. La tabla entrega los mismos valores.</figcaption>
    </figure>
  )
}
