import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { FlowBreakdowns } from '@/components/dashboard/analytics/flow-breakdowns'
import type { FlowBreakdownGroup, FlowBreakdownsReport } from '@/lib/analytics/report-types'

function group(entryKind: FlowBreakdownGroup['entryKind'], maturity: FlowBreakdownGroup['maturity'], attempts: number): FlowBreakdownGroup {
  return {
    entryKind, maturity, attempts, incompleteCapture: 0,
    professional: { not_observed: attempts, 'none:not_required': 0, 'none:not_observed': 0, 'anyone:explicit': 0, 'anyone:not_required': 0, 'anyone:not_observed': 0, 'person:explicit': 0, 'person:not_required': 0, 'person:not_observed': 0 },
    screen: { not_observed: attempts, cobrar: 0, 'sin-abono': 0, 'sin-pago-online': 0, verificando: 0 },
    condition: { not_observed: attempts, package: 0, promotion_zero: 0, free_service: 0, no_deposit: 0, deposit_required: 0 },
    offeredMethods: { not_observed: attempts, none_offered: 0, online: 0, transfer: 0, manual: 0 },
    selectedMethod: { not_observed: attempts, online: 0, transfer: 0, manual: 0 },
    errors: { 'availability:error': 0, 'promotion:rejected:invalid': 0, 'promotion:rejected:expired': 0, 'promotion:rejected:ineligible': 0, 'promotion:rejected:limit_reached': 0, 'promotion:rejected:unknown': 0, 'promotion:error:network': 0, 'promotion:error:unavailable': 0, 'promotion:error:unknown': 0, 'submission:rejected:validation': 0, 'submission:rejected:slot_unavailable': 0, 'submission:rejected:unauthorized': 0, 'submission:rejected:network': 0, 'submission:rejected:unknown': 0, 'submission:error:validation': 0, 'submission:error:slot_unavailable': 0, 'submission:error:unauthorized': 0, 'submission:error:network': 0, 'submission:error:unknown': 0 },
  }
}
const metadata = { from: '2026-08-01', to: '2026-08-29', cutoffAt: '2026-08-29T00:00:00.000Z', timezones: ['UTC', 'America/Santiago'], scope: 'all_attempts' as const }
function available(): FlowBreakdownsReport {
  const mature = group('complete', 'mature', 7)
  mature.incompleteCapture = 2
  mature.professional = { ...mature.professional, not_observed: 2, 'person:explicit': 2, 'anyone:explicit': 1, 'anyone:not_required': 1, 'none:not_required': 1 }
  mature.screen = { not_observed: 0, cobrar: 4, verificando: 1, 'sin-abono': 1, 'sin-pago-online': 1 }
  mature.condition = { not_observed: 0, deposit_required: 4, package: 1, promotion_zero: 1, no_deposit: 1, free_service: 0 }
  mature.offeredMethods = { not_observed: 1, none_offered: 1, online: 4, transfer: 3, manual: 2 }
  mature.selectedMethod = { not_observed: 4, online: 1, transfer: 2, manual: 0 }
  mature.errors['availability:error'] = 2
  mature.errors['promotion:rejected:invalid'] = 1
  mature.errors['submission:error:network'] = 1
  return { ...metadata, status: 'available', groups: [mature, group('complete', 'in_progress', 3), group('partial', 'mature', 5), group('partial', 'in_progress', 2)] }
}
function render(report: FlowBreakdownsReport) {
  const host = document.createElement('div')
  host.innerHTML = renderToStaticMarkup(<FlowBreakdowns report={report} />)
  return host
}
function rows(host: Element | null, label: string) {
  return [...(host?.querySelectorAll(`table[aria-label="${label}"] tbody tr`) ?? [])].map(row => row.textContent)
}

describe('FlowBreakdowns', () => {
  it('keeps the four entry/maturity populations and incomplete capture counts separate', () => {
    const host = render(available())
    for (const [label, count] of [['Entrada completa · maduros', 7], ['Entrada completa · en curso', 3], ['Entrada parcial · maduros', 5], ['Entrada parcial · en curso', 2]] as const) {
      const population = host.querySelector(`section[aria-label="${label}"]`)!
      expect(population).not.toBeNull()
      expect(population.querySelector('h3')?.textContent).toBe(label)
      expect(population.querySelector('[data-flow-count]')?.textContent).toBe(`${count} intentos observados`)
    }
    expect(host.querySelector('section[aria-label="Entrada completa · maduros"]')?.textContent).toContain('2 con captura incompleta')
    expect(host.textContent).toContain('24 h')
    expect(host.textContent).toContain('no se comparan')
  })

  it('distinguishes explicit professionals, automatic optional steps and unknown evidence', () => {
    const host = render(available())
    const mature = host.querySelector('section[aria-label="Entrada completa · maduros"]')!
    expect(rows(mature, 'Elección profesional')).toEqual(['Persona específica · elección explícita2', 'Cualquier profesional · elección explícita1', 'Cualquier profesional · paso no requerido1', 'Sin profesional · paso no requerido1', 'No observado2'])
    expect(host.textContent).toContain('no significa que no eligió')
    expect(host.textContent).not.toContain('person:explicit')
    expect(host.textContent).not.toContain('professionalId')
  })

  it('separates payment screen, economic condition, offered methods and explicit selection', () => {
    const mature = render(available()).querySelector('section[aria-label="Entrada completa · maduros"]')!
    expect(rows(mature, 'Pantalla de pago')).toEqual(['Cobro4', 'Sin abono1', 'Verificando1', 'Sin pago en línea1'])
    expect(rows(mature, 'Condición económica')).toEqual(['Abono requerido4', 'Paquete1', 'Promoción con importe cero1', 'Sin abono requerido1'])
    expect(rows(mature, 'Métodos ofrecidos')).toEqual(['En línea4', 'Transferencia3', 'Manual2', 'Ningún método ofrecido1', 'No observado1'])
    expect(rows(mature, 'Método elegido')).toEqual(['En línea1', 'Transferencia2', 'No observado4'])
    expect(mature.querySelector('details > summary')).not.toBeNull()
    expect(mature.querySelector('details')?.hasAttribute('open')).toBe(false)
    expect(mature.textContent).not.toMatch(/deposit_required|promotion_zero|none_offered/)
  })

  it('labels non-additive evidence and does not infer payment, abandonment or error-free attempts', () => {
    const host = render(available())
    expect(host.textContent).toContain('Métodos ofrecidos y errores no son aditivos')
    expect(host.textContent).toContain('Elegido no significa pagado')
    expect(host.textContent).toContain('no prueba abandono, pérdida comercial ni estado financiero')
    expect(rows(host.querySelector('section[aria-label="Entrada completa · maduros"]')!, 'Errores observados')).toEqual(['Disponibilidad · error2', 'Promoción rechazada · inválida1', 'Envío con error · red1'])
    expect(host.querySelector('section[aria-label="Entrada parcial · maduros"]')?.textContent).toContain('Sin errores observados en este grupo')
  })

  it('shows the exclusive window, cutoff and frozen zones without widening the selected period', () => {
    const host = render(available())
    expect(host.textContent).toContain('Desde 2026-08-01 hasta 2026-08-29 (fin exclusivo)')
    expect(host.querySelector('time')?.getAttribute('datetime')).toBe('2026-08-29T00:00:00.000Z')
    expect(host.textContent).toContain('UTC, America/Santiago')
    expect(host.textContent).toContain('fecha de cohorte y zona congeladas')
    expect(host.textContent).toContain('máximo 90 días')
    expect(host.textContent).toContain('10.000 fuentes')
    expect(host.textContent).toContain('200 eventos por intento')
    expect(host.textContent).toContain('50.000 eventos')
  })

  it.each([
    ['all_attempts', 'Todos los intentos del período'], ['channel', 'Canal de adquisición del intento'],
    ['acquisition_link', 'Enlace de adquisición del intento'], ['final_service', 'Servicio del último contexto observado'],
  ] as const)('explains scope %s without presenting historical interest as final service', (scope, label) => {
    const host = render({ ...available(), scope })
    expect(host.textContent).toContain(label)
    if (scope === 'final_service') expect(host.textContent).toContain('no incluye todos los servicios considerados')
  })

  it.each([
    ['not_retained', 'Detalle no retenido'], ['incomplete_source', 'Fuente incompleta'],
    ['limit_exceeded', 'Límite de lectura excedido'], ['error', 'Error al consultar el detalle'],
  ] as const)('renders %s without zero or partial count tables', (status, label) => {
    const host = render({ ...metadata, status, groups: null })
    expect(host.querySelector('h2')?.textContent).toBe('Detalle del flujo observado')
    expect(host.textContent).toContain(label)
    expect(host.textContent).toContain('no se reconstruye')
    expect(host.querySelector('table')).toBeNull()
    expect(host.querySelector('[data-flow-count]')).toBeNull()
    if (status === 'limit_exceeded') expect(host.textContent).toContain('Acorta el rango')
  })

  it('distinguishes a successful empty read from unavailable detail and zero traffic', () => {
    const host = render({ ...metadata, timezones: [], status: 'empty', groups: [group('complete', 'mature', 0), group('complete', 'in_progress', 0), group('partial', 'mature', 0), group('partial', 'in_progress', 0)] })
    expect(host.textContent).toContain('Sin intentos observados en este rango')
    expect(host.textContent).toContain('no confirma tráfico cero ni captura activa')
    expect(host.textContent).toContain('zona actual del selector')
    expect(host.querySelectorAll('h3')).toHaveLength(4)
    expect(host.querySelector('table')).toBeNull()
    expect(render(available()).textContent).toContain('Detalle disponible')
  })
})
