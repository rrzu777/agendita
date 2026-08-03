import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

/**
 * Las dos piezas puras que gobiernan el selector de persona de la reserva
 * manual del panel (el formulario entero necesita interacción para llegar a
 * cada estado):
 *
 * - `ProfessionalField`: los tres casos de `professionalChoice` (sin equipo /
 *   una sola / dos o más), y que "Cualquiera disponible" va PRIMERA como en el
 *   funnel. Los colapsos de `professionalFields` ya los cubre
 *   `professional-choice.test.ts` — acá sólo lo propio del panel.
 * - `effectiveDashboardPick`: la elección vieja de alguien que dejó de ser
 *   elegible vuelve a "cualquiera", nunca a "sin persona" — sin persona con
 *   equipo elegible chocaría contra el equipo entero.
 */

import { ProfessionalField } from '@/components/dashboard/professional-field'
import { effectiveDashboardPick, professionalChoice, type FunnelProfessional } from '@/lib/professionals/eligible'

function persona(id: string, name: string, serviceIds: string[] = ['svc-1']): FunnelProfessional {
  return { id, name, bio: null, modalities: ['on_site'], serviceIds }
}

// Nombres que no son substring de ningún otro texto renderizado.
const RAUL = persona('prof-1', 'RaulBarbero')
const SOFI = persona('prof-2', 'SofiBarbera')

describe('ProfessionalField', () => {
  it('con dos o más elegibles pregunta, y "Cualquiera disponible" va primera', () => {
    const choice = professionalChoice([RAUL, SOFI], 'svc-1', 'on_site')
    const html = renderToStaticMarkup(
      <ProfessionalField choice={choice} pick={{ kind: 'anyone' }} onChange={() => {}} />,
    )

    expect(html).toContain('¿Quién atiende?')
    const primeraOpcion = html.indexOf('<option')
    expect(html.indexOf('Cualquiera disponible')).toBeGreaterThan(primeraOpcion)
    expect(html.indexOf('Cualquiera disponible')).toBeLessThan(html.indexOf('RaulBarbero'))
    expect(html).toContain('SofiBarbera')
  })

  it('la persona elegida queda seleccionada', () => {
    const choice = professionalChoice([RAUL, SOFI], 'svc-1', 'on_site')
    const html = renderToStaticMarkup(
      <ProfessionalField choice={choice} pick={{ kind: 'person', id: 'prof-2' }} onChange={() => {}} />,
    )

    expect(html.match(/<option[^>]*selected[^>]*>SofiBarbera/)).toBeTruthy()
  })

  it('con una sola persona elegible no pregunta', () => {
    const choice = professionalChoice([RAUL], 'svc-1', 'on_site')
    const html = renderToStaticMarkup(
      <ProfessionalField choice={choice} pick={{ kind: 'anyone' }} onChange={() => {}} />,
    )

    expect(html).toBe('')
  })

  it('sin equipo elegible no aparece', () => {
    const choice = professionalChoice([], 'svc-1', 'on_site')
    const html = renderToStaticMarkup(
      <ProfessionalField choice={choice} pick={{ kind: 'anyone' }} onChange={() => {}} />,
    )

    expect(html).toBe('')
  })
})

describe('effectiveDashboardPick', () => {
  const ask = professionalChoice([RAUL, SOFI], 'svc-1', 'on_site')

  it('una persona que dejó de ser elegible vuelve a "cualquiera", nunca a "sin persona"', () => {
    expect(effectiveDashboardPick(ask, { kind: 'person', id: 'prof-borrada' })).toEqual({ kind: 'anyone' })
  })

  it('una persona vigente se conserva', () => {
    expect(effectiveDashboardPick(ask, { kind: 'person', id: 'prof-1' })).toEqual({ kind: 'person', id: 'prof-1' })
  })

  it('"cualquiera" pasa tal cual', () => {
    expect(effectiveDashboardPick(ask, { kind: 'anyone' })).toEqual({ kind: 'anyone' })
  })
})
