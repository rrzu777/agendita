import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}))

import { EditBlockDialog } from '@/components/dashboard/edit-block-dialog'

const block = {
  id: 'block-1',
  startDateTime: '2026-06-01T17:00:00.000Z',
  endDateTime: '2026-06-01T18:00:00.000Z',
  reason: 'Almuerzo',
}

describe('EditBlockDialog', () => {
  it('renderiza sin lanzar errores', () => {
    expect(() =>
      renderToStaticMarkup(
        <EditBlockDialog block={block} timezone="America/Santiago" open={false} onOpenChange={() => {}} />,
      ),
    ).not.toThrow()
  })
})
