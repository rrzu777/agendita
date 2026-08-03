import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

/**
 * El selector de persona de la reserva manual del panel. El formulario entero
 * necesita interacción para llegar a cada estado, así que acá se verifican las
 * dos piezas puras que lo gobiernan:
 *
 * - `ProfessionalField`: los tres casos de `professionalChoice` (sin equipo /
 *   una sola / dos o más), y que "Cualquiera disponible" va PRIMERA como en el
 *   funnel.
 * - `effectiveDashboardPick`: la elección vieja de alguien que dejó de ser
 *   elegible vuelve a "cualquiera", nunca a "sin persona" — sin persona con
 *   equipo elegible chocaría contra el equipo entero.
 */

vi.mock('next/navigation', () => ({
  redirect: vi.fn(),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), back: vi.fn() }),
}))

import { effectiveDashboardPick, ProfessionalField } from '@/app/dashboard/bookings/new/new-booking-form'
import { professionalChoice, professionalFields, type FunnelProfessional } from '@/lib/professionals/eligible'

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

    expect(html).toContain('selected')
    expect(html.match(/<option[^>]*selected[^>]*>SofiBarbera/)).toBeTruthy()
  })

  it('con una sola persona elegible no pregunta (la asignación la colapsa professionalFields)', () => {
    const choice = professionalChoice([RAUL], 'svc-1', 'on_site')
    const html = renderToStaticMarkup(
      <ProfessionalField choice={choice} pick={{ kind: 'anyone' }} onChange={() => {}} />,
    )

    expect(html).toBe('')
    // ...pero la reserva igual queda a su nombre:
    expect(professionalFields(choice, { kind: 'anyone' })).toEqual({
      professional: { kind: 'person', id: 'prof-1' },
      professionalName: 'RaulBarbero',
    })
  })

  it('sin equipo elegible no aparece y la reserva va sin persona', () => {
    const choice = professionalChoice([], 'svc-1', 'on_site')
    const html = renderToStaticMarkup(
      <ProfessionalField choice={choice} pick={{ kind: 'anyone' }} onChange={() => {}} />,
    )

    expect(html).toBe('')
    expect(professionalFields(choice, { kind: 'anyone' })).toEqual({
      professional: { kind: 'none' },
      professionalName: '',
    })
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
