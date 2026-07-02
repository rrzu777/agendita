import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))

import { RecurringBlockList } from '@/components/dashboard/recurring-block-list'

describe('RecurringBlockList', () => {
  it('lista series con sus días y horario', () => {
    const html = renderToStaticMarkup(
      <RecurringBlockList series={[{ id: 's1', daysOfWeek: [1, 2, 3, 4], startTime: '13:00', endTime: '14:00', reason: 'Almuerzo', until: null }]} />,
    )
    expect(html).toContain('Almuerzo')
    expect(html).toContain('13:00')
    expect(html).toContain('Lun')
  })

  it('muestra vacío cuando no hay series', () => {
    const html = renderToStaticMarkup(<RecurringBlockList series={[]} />)
    expect(html).toContain('No tienes bloqueos recurrentes')
  })
})
