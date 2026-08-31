import { Card, CardContent, CardHeader } from '@/components/ui/card'
import type { FlowBreakdownGroup, FlowBreakdownsReport } from '@/lib/analytics/report-types'

const professionalLabels = {
  'person:explicit': 'Persona específica · elección explícita',
  'anyone:explicit': 'Cualquier profesional · elección explícita',
  'person:not_required': 'Persona específica · paso no requerido',
  'anyone:not_required': 'Cualquier profesional · paso no requerido',
  'none:not_required': 'Sin profesional · paso no requerido',
  'person:not_observed': 'Persona específica · elección no observada',
  'anyone:not_observed': 'Cualquier profesional · elección no observada',
  'none:not_observed': 'Sin profesional · elección no observada',
  not_observed: 'No observado',
} satisfies Record<keyof FlowBreakdownGroup['professional'], string>
const screenLabels = {
  cobrar: 'Cobro', 'sin-abono': 'Sin abono', verificando: 'Verificando', 'sin-pago-online': 'Sin pago en línea', not_observed: 'No observado',
} satisfies Record<keyof FlowBreakdownGroup['screen'], string>
const conditionLabels = {
  deposit_required: 'Abono requerido', package: 'Paquete', promotion_zero: 'Promoción con importe cero', free_service: 'Servicio gratuito', no_deposit: 'Sin abono requerido', not_observed: 'No observado',
} satisfies Record<keyof FlowBreakdownGroup['condition'], string>
const methodLabels = { online: 'En línea', transfer: 'Transferencia', manual: 'Manual', not_observed: 'No observado' } satisfies Record<keyof FlowBreakdownGroup['selectedMethod'], string>
const offeredLabels = { online: 'En línea', transfer: 'Transferencia', manual: 'Manual', none_offered: 'Ningún método ofrecido', not_observed: 'No observado' } satisfies Record<keyof FlowBreakdownGroup['offeredMethods'], string>
const errorLabels = {
  'availability:error': 'Disponibilidad · error',
  'promotion:rejected:invalid': 'Promoción rechazada · inválida',
  'promotion:rejected:expired': 'Promoción rechazada · vencida',
  'promotion:rejected:ineligible': 'Promoción rechazada · no aplicable',
  'promotion:rejected:limit_reached': 'Promoción rechazada · límite alcanzado',
  'promotion:rejected:unknown': 'Promoción rechazada · motivo no observado',
  'promotion:error:network': 'Promoción con error · red',
  'promotion:error:unavailable': 'Promoción con error · no disponible',
  'promotion:error:unknown': 'Promoción con error · motivo no observado',
  'submission:rejected:validation': 'Envío rechazado · validación',
  'submission:rejected:slot_unavailable': 'Envío rechazado · horario no disponible',
  'submission:rejected:unauthorized': 'Envío rechazado · sin autorización',
  'submission:rejected:network': 'Envío rechazado · red',
  'submission:rejected:unknown': 'Envío rechazado · motivo no observado',
  'submission:error:validation': 'Envío con error · validación',
  'submission:error:slot_unavailable': 'Envío con error · horario no disponible',
  'submission:error:unauthorized': 'Envío con error · sin autorización',
  'submission:error:network': 'Envío con error · red',
  'submission:error:unknown': 'Envío con error · motivo no observado',
} satisfies Record<keyof FlowBreakdownGroup['errors'], string>
const statusLabels = {
  available: 'Detalle disponible', empty: 'Sin intentos observados en este rango',
  not_retained: 'Detalle no retenido', incomplete_source: 'Fuente incompleta',
  limit_exceeded: 'Límite de lectura excedido', error: 'Error al consultar el detalle',
} satisfies Record<FlowBreakdownsReport['status'], string>
const statusHelp = {
  available: 'Conteos de intentos con observaciones todavía retenidas.',
  empty: 'La lectura fue correcta; no confirma tráfico cero ni captura activa.',
  not_retained: 'Las observaciones de este rango ya no están retenidas. Un agregado histórico no permite verificar estas distribuciones.',
  incomplete_source: 'Falta evidencia necesaria para verificar la lectura completa. No se muestran conteos parciales.',
  limit_exceeded: 'Acorta el rango para consultar el detalle. No se muestra sólo la parte que alcanzó a leerse.',
  error: 'No se pudo completar la consulta del detalle. Vuelve a intentar; el resumen histórico es independiente.',
} satisfies Record<FlowBreakdownsReport['status'], string>
const scopeLabels = {
  all_attempts: 'Todos los intentos del período', channel: 'Canal de adquisición del intento',
  acquisition_link: 'Enlace de adquisición del intento', final_service: 'Servicio del último contexto observado',
} satisfies Record<FlowBreakdownsReport['scope'], string>

function CountTable<K extends string>({ label, counts, labels }: { label: string; counts: Record<K, number>; labels: Record<K, string> }) {
  const rows = (Object.keys(labels) as K[]).filter(key => counts[key] > 0)
  if (!rows.length) return null
  return <table aria-label={label} className="w-full table-fixed text-sm">
    <caption className="pb-2 text-left font-medium text-primary">{label}</caption>
    <thead><tr className="border-b border-border text-xs text-muted-foreground"><th scope="col" className="pb-2 text-left font-normal">Observación</th><th scope="col" className="w-16 pb-2 text-right font-normal">Intentos</th></tr></thead>
    <tbody>{rows.map(key => <tr key={key} className="border-b border-border/60 last:border-0"><th scope="row" className="break-words py-2 pr-3 text-left font-normal">{labels[key]}</th><td className="py-2 text-right align-top font-mono tabular-nums">{counts[key]}</td></tr>)}</tbody>
  </table>
}

function Population({ group }: { group: FlowBreakdownGroup }) {
  const label = `Entrada ${group.entryKind === 'complete' ? 'completa' : 'parcial'} · ${group.maturity === 'mature' ? 'maduros' : 'en curso'}`
  const hasErrors = Object.values(group.errors).some(count => count > 0)
  return <section aria-label={label} className="min-w-0 self-start rounded-xl border border-border p-4 lg:has-[details[open]]:col-span-2">
    <h3 className="font-heading text-base font-semibold text-primary">{label}</h3>
    <p data-flow-count className="mt-2 font-medium">{group.attempts} {group.attempts === 1 ? 'intento observado' : 'intentos observados'}</p>
    {group.attempts === 0 ? <p className="mt-1 text-sm text-muted-foreground">Sin intentos observados en esta población.</p> : <>
      <p className="mt-1 text-sm text-muted-foreground">{group.incompleteCapture} con captura incompleta.</p>
      <details className="mt-3 border-t border-border pt-3">
        <summary className="cursor-pointer rounded-sm text-sm font-medium text-primary focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring">Ver profesional, pago y errores</summary>
        <div className="mt-5 grid items-start gap-6 md:grid-cols-2 xl:grid-cols-3">
          <CountTable label="Elección profesional" counts={group.professional} labels={professionalLabels} />
          <CountTable label="Pantalla de pago" counts={group.screen} labels={screenLabels} />
          <CountTable label="Condición económica" counts={group.condition} labels={conditionLabels} />
          <CountTable label="Métodos ofrecidos" counts={group.offeredMethods} labels={offeredLabels} />
          <CountTable label="Método elegido" counts={group.selectedMethod} labels={methodLabels} />
          {hasErrors ? <CountTable label="Errores observados" counts={group.errors} labels={errorLabels} /> : <p className="text-sm text-muted-foreground">Sin errores observados en este grupo; no prueba ausencia de errores.</p>}
        </div>
      </details>
    </>}
  </section>
}

export function FlowBreakdowns({ report }: { report: FlowBreakdownsReport }) {
  const cutoff = new Intl.DateTimeFormat('es-CL', { timeZone: 'UTC', dateStyle: 'medium', timeStyle: 'medium' }).format(new Date(report.cutoffAt))
  return <section aria-label="Detalle del flujo observado" className="min-w-0">
    <Card>
      <CardHeader className="space-y-3">
        <h2 className="font-heading text-xl font-semibold text-primary">Detalle del flujo observado</h2>
        <div className="space-y-1 text-sm text-muted-foreground">
          <p>Desde {report.from} hasta {report.to} (fin exclusivo), por fecha de cohorte y zona congeladas.</p>
          <p>Corte: <time dateTime={report.cutoffAt}>{cutoff} UTC</time>.</p>
          <p className="break-words">Zonas de las fuentes: {report.timezones.length ? report.timezones.join(', ') : 'sin zonas observadas; las fechas del selector usan la zona actual del selector indicada arriba'}.</p>
          <p>Alcance: <span className="font-medium text-primary">{scopeLabels[report.scope]}</span>{report.scope === 'final_service' ? '; no incluye todos los servicios considerados.' : '.'}</p>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="rounded-lg bg-secondary/30 p-3 text-sm"><p className="font-medium text-primary">{statusLabels[report.status]}</p><p className="mt-1 text-muted-foreground">{statusHelp[report.status]}</p></div>
        <p className="text-sm text-muted-foreground">Sólo observaciones retenidas, máximo 90 días. Este detalle no se reconstruye desde agregados históricos ni hitos.</p>
        {report.groups !== null && <>
          <p className="text-sm text-muted-foreground">La unidad es el intento, no eventos ni personas. Entrada completa: observada desde el primer paso; parcial: restauración o consentimiento a mitad del flujo. Maduros: ya tuvieron 24 h; los intentos en curso no se comparan con ellos.</p>
          <div className="grid items-start gap-4 lg:grid-cols-2">{report.groups.map(group => <Population key={`${group.entryKind}-${group.maturity}`} group={group} />)}</div>
          <div className="space-y-2 text-sm text-muted-foreground">
            <p>Se muestra el último contexto válido observado. «No observado» no significa que no eligió. «Paso no requerido» describe la configuración automática, no una elección explícita.</p>
            <p>Elegido no significa pagado: requiere una selección explícita observada, no una preselección. La pantalla y la condición económica tampoco acreditan cobro.</p>
            <p>Métodos ofrecidos y errores no son aditivos: un intento puede aparecer en varias filas; cada categoría de error se cuenta una vez por intento en el contexto vigente. Un error observado no prueba abandono, pérdida comercial ni estado financiero.</p>
          </div>
        </>}
        <p className="text-xs text-muted-foreground">Límites por rango antes del filtro: 10.000 fuentes (sesiones + intentos), 200 eventos por intento y 50.000 eventos de intento en total. Si se exceden o falta evidencia, no se publican conteos parciales.</p>
      </CardContent>
    </Card>
  </section>
}
