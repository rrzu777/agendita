import type { OwnerAnalyticsReport } from '@/server/analytics/reports'

function percent(value: number, max: number) {
  return max === 0 ? 100 : 100 - (value / max) * 76 - 12
}

export function TrendChart({ trend, coverage, unavailable }: { trend: OwnerAnalyticsReport['trend']; coverage: OwnerAnalyticsReport['coverage']['cohorts']; unavailable: boolean }) {
  if (unavailable) return <p className="rounded-lg bg-secondary/50 p-4 text-sm text-muted-foreground">Datos no disponibles para dibujar una tendencia fiable.</p>
  if (trend.length === 0) return <p className="rounded-lg bg-secondary/50 p-4 text-sm text-muted-foreground">Aún no hay días observados en este período.</p>

  const max = Math.max(1, ...trend.map((day) => day.complete.attempts))
  const ordered = coverage.length ? coverage : trend.map(day => ({ date: day.date, timezone: day.timezone, state: 'closed', coverage: 'complete' }))
  const segments: { x: number; y: number; key: string }[][] = []
  let segment: { x: number; y: number; key: string }[] = []
  ordered.forEach((cohort, index) => { const day = trend.find(row => row.date === cohort.date && row.timezone === cohort.timezone); const available = cohort.state === 'closed' && day; if (!available) { if (segment.length) segments.push(segment); segment = []; return }; segment.push({ x: ordered.length === 1 ? 50 : 4 + (index / (ordered.length - 1)) * 92, y: percent(day.complete.attempts, max), key: `${day.date}-${day.timezone}` }) })
  if (segment.length) segments.push(segment)

  return (
    <figure aria-labelledby="trend-title" className="space-y-3">
      <svg data-segments={segments.length} viewBox="0 0 100 100" role="img" aria-label="Tendencia visual de intentos completos" className="h-40 w-full rounded-lg bg-secondary/30 p-3" preserveAspectRatio="none">
        <line x1="4" x2="96" y1="88" y2="88" stroke="currentColor" strokeOpacity=".25" vectorEffect="non-scaling-stroke" />
        {segments.map((points, index) => <polyline key={index} points={points.map(p => `${p.x},${p.y}`).join(' ')} fill="none" stroke="currentColor" strokeWidth="2" vectorEffect="non-scaling-stroke" className="text-primary" />)}
        {segments.flat().map(point => <circle key={point.key} cx={point.x} cy={point.y} r="2" fill="currentColor" className="text-primary" />)}
      </svg>
      <figcaption id="trend-title" className="text-xs text-muted-foreground">Intentos completos maduros por día. Discontinuidades de cobertura se muestran como líneas separadas.</figcaption>
    </figure>
  )
}
