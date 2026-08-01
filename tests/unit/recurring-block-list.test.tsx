import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))

import { RecurringBlockList } from '@/components/dashboard/recurring-block-list'

const almuerzo = {
  id: 's1',
  daysOfWeek: [1, 2, 3, 4],
  startTime: '13:00',
  endTime: '14:00',
  reason: 'Almuerzo',
  until: null,
  ownerLabel: null,
}

describe('RecurringBlockList', () => {
  it('lista series con sus días y horario', () => {
    const html = renderToStaticMarkup(<RecurringBlockList series={[almuerzo]} />)
    expect(html).toContain('Almuerzo')
    expect(html).toContain('13:00')
    expect(html).toContain('Lun')
  })

  it('muestra vacío cuando no hay series', () => {
    const html = renderToStaticMarkup(<RecurringBlockList series={[]} />)
    expect(html).toContain('No tienes bloqueos recurrentes')
  })

  // Mirando a una persona la lista viene mezclada con las del negocio, y las dos
  // cierran su agenda: sin la etiqueta, un almuerzo de todo el equipo se lee como suyo.
  it('muestra de quién es la serie cuando la página lo pide', () => {
    const html = renderToStaticMarkup(
      <RecurringBlockList series={[{ ...almuerzo, ownerLabel: 'Todo el negocio' }]} />,
    )
    expect(html).toContain('Todo el negocio')
  })
})
