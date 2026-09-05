import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import type { readWeeklyInsights } from '@/server/actions/weekly-insights'
import { WeeklyInsightPreferences } from './weekly-insight-preferences'

type WeeklyData = Awaited<ReturnType<typeof readWeeklyInsights>>

const statusLabels: Record<string, string> = {
  insufficient_data: 'Aún no hay suficiente historia',
  deterministic_ready: 'Resumen determinístico listo',
  generating: 'Analizando con IA',
  ready: 'Resumen con análisis asistido listo',
  generation_failed: 'Resumen determinístico; análisis asistido no disponible',
  expired: 'Resumen vencido',
}

function factsOf(value: unknown): { visits?: number; matureCompleteAttempts?: number; conversion?: { numerator: number; denominator: number; rate: number | null }; signals?: { factId: string; numerator: number; denominator: number; rate: number | null }[] } | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const facts = value as Record<string, unknown>
  return { visits: typeof facts.visits === 'number' ? facts.visits : undefined, matureCompleteAttempts: typeof facts.matureCompleteAttempts === 'number' ? facts.matureCompleteAttempts : undefined, conversion: facts.conversion && typeof facts.conversion === 'object' ? facts.conversion as { numerator: number; denominator: number; rate: number | null } : undefined, signals: Array.isArray(facts.signals) ? facts.signals as { factId: string; numerator: number; denominator: number; rate: number | null }[] : undefined }
}

export function WeeklyInsightCard({ data }: { data: WeeklyData | null }) {
  if (!data || data.rows.length === 0) return null
  return <section aria-label="Insights semanales" className="space-y-3">
    <div><h2 className="font-heading text-2xl font-semibold text-primary">Insights semanales</h2><p className="text-sm text-muted-foreground">Hechos de cohortes cerradas; el análisis asistido permanece separado y puede estar deshabilitado.</p></div>
    <WeeklyInsightPreferences preference={data.preference} />
    <div className="grid gap-4 md:grid-cols-2">
      {data.rows.map(row => {
        const facts = factsOf(row.facts)
        const narrative = row.narrative && typeof row.narrative === 'object' && !Array.isArray(row.narrative) ? row.narrative as { summary?: string; findings?: { statement?: string }[] } : null
        return <Card key={row.id}>
          <CardHeader><CardTitle>Semana {row.weekStart.toISOString().slice(0, 10)} · {statusLabels[row.status] ?? row.status}</CardTitle><CardDescription>{row.sourceConsentVersion === 2 ? 'Fuente con consentimiento vigente.' : 'Resumen de fuente histórica v1; no se envía a IA.'}</CardDescription></CardHeader>
          <CardContent className="space-y-2 text-sm">
            {facts?.conversion && <p>Conversión: {facts.conversion.numerator} de {facts.conversion.denominator}{facts.conversion.rate === null ? '' : ` · ${Math.round(facts.conversion.rate * 100)}%`}.</p>}
            {facts?.matureCompleteAttempts !== undefined && <p>{facts.matureCompleteAttempts} intentos completos maduros · {facts.visits ?? 0} visitas.</p>}
            {narrative?.summary && row.status === 'ready' && <p className="rounded-lg bg-secondary/40 p-3">{narrative.summary}</p>}
            {narrative?.findings?.map((finding, index) => finding.statement ? <p key={index}>• {finding.statement}</p> : null)}
            {facts?.signals?.map(signal => <p key={signal.factId} className="text-muted-foreground">Señal {signal.factId}: {signal.numerator} de {signal.denominator}.</p>)}
            {row.reasonCode && <p className="text-muted-foreground">Motivo: {row.reasonCode}.</p>}
          </CardContent>
        </Card>
      })}
    </div>
  </section>
}
