import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('@/server/actions/time-blocks', () => ({ deleteTimeBlock: vi.fn() }))

import { TimeBlockList } from '@/components/dashboard/time-block-form'

const bloqueo = {
  id: 'b1',
  startDateTime: '2026-06-30T17:00:00.000Z',
  endDateTime: '2026-06-30T18:00:00.000Z',
  reason: 'Almuerzo',
  ownerLabel: null,
}

describe('TimeBlockList', () => {
  it('lista cada bloqueo con su motivo', () => {
    const html = renderToStaticMarkup(<TimeBlockList blocks={[bloqueo]} />)
    expect(html).toContain('Almuerzo')
  })

  it('muestra vacío cuando no hay bloqueos', () => {
    const html = renderToStaticMarkup(<TimeBlockList blocks={[]} />)
    expect(html).toContain('No hay horarios bloqueados')
  })

  /**
   * Mirando a una persona, la lista viene MEZCLADA: los suyos más los del negocio, que
   * son los dos que le cierran la agenda. Sin la etiqueta, borrar lo que parece "su"
   * almuerzo le abre el horario a todo el equipo.
   */
  it('muestra de quién es cada bloqueo cuando la página lo pide', () => {
    const html = renderToStaticMarkup(
      <TimeBlockList
        blocks={[
          { ...bloqueo, ownerLabel: 'Todo el negocio' },
          { ...bloqueo, id: 'b2', reason: 'Dentista', ownerLabel: 'Ana' },
        ]}
      />,
    )
    expect(html).toContain('Todo el negocio')
    expect(html).toContain('Ana')
  })

  // Mirando el horario del negocio no hay nada que aclarar —todos los bloqueos son
  // suyos— y una etiqueta repetida en cada fila es ruido.
  it('no dibuja ninguna etiqueta cuando no hay nada que aclarar', () => {
    const html = renderToStaticMarkup(<TimeBlockList blocks={[bloqueo]} />)
    expect(html).not.toContain('Todo el negocio')
  })
})
