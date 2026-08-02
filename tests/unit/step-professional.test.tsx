import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { BusinessCategory } from '@prisma/client'
import { getVocabulary } from '@/lib/vocabulary'
import { StepProfessional } from '@/components/booking/step-professional'
import type { FunnelProfessional } from '@/lib/professionals/eligible'

// Los componentes de UI que arrastra el paso no llaman al router, pero el mock queda
// por la misma razón que en el panel: un import indirecto que sí lo llame revienta
// renderToStaticMarkup y el error no señala al culpable.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}))

const OPCIONES: FunnelProfessional[] = [
  { id: 'p-1', name: 'Juan', bio: 'Fade y barba', modalities: ['on_site'], serviceIds: ['svc-1'] },
  { id: 'p-2', name: 'Sofía', bio: null, modalities: ['on_site'], serviceIds: ['svc-1'] },
]

function render(category: BusinessCategory = 'barber', selectedId: string | null = null) {
  return renderToStaticMarkup(
    <StepProfessional
      options={OPCIONES}
      selectedId={selectedId}
      serviceName="Corte"
      title={getVocabulary(category).chooseProfessional}
      onSelect={() => {}}
      onBack={() => {}}
    />,
  )
}

describe('el paso de con quién', () => {
  it('lista a cada persona con su nombre y su bio', () => {
    const markup = render()
    expect(markup).toContain('Juan')
    expect(markup).toContain('Sofía')
    expect(markup).toContain('Fade y barba')
  })

  it('el título sale del oficio del rubro', () => {
    expect(render('barber')).toContain('Elegí tu barbero')
    expect(render('nails')).toContain('Elegí tu manicurista')
  })

  // Avisar que la agenda es por persona es lo que explica que los horarios cambien
  // al volver atrás y elegir a otra. Sin eso parece que la app se equivoca.
  it('avisa que los horarios dependen de a quién elija', () => {
    expect(render()).toContain('cada persona tiene su propia agenda')
  })

  it('marca cuál está elegida para quien vuelve atrás', () => {
    expect(render('barber', 'p-2')).toContain('aria-pressed="true"')
  })

  /**
   * El oficio es de género común en cinco de los seis rubros: lo que cambia es el
   * artículo, y el del rubro está fijo. Un salón de estilistas varones leería "la
   * estilista". La decisión de producto fue no usar nunca las formas con artículo —
   * en la lista van nombres propios, que no necesitan género— y esto es el cerrojo:
   * la próxima frase que las use falla acá y no en la pantalla de una clienta.
   */
  it('no usa las formas con artículo del oficio', () => {
    for (const category of ['hair_salon', 'beauty', 'nails'] as BusinessCategory[]) {
      const markup = render(category)
      const v = getVocabulary(category)
      expect(markup, `${category}.theProfessional`).not.toContain(v.theProfessional)
      expect(markup, `${category}.aProfessional`).not.toContain(v.aProfessional)
    }
  })
})
