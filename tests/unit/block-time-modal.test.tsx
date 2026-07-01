import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}))

import { BlockTimeModal } from '@/components/dashboard/block-time-modal'

describe('BlockTimeModal', () => {
  it('renderiza el botón para crear un bloqueo', () => {
    const html = renderToStaticMarkup(
      <BlockTimeModal defaultDate="2026-06-01" timezone="America/Santiago" />,
    )
    expect(html).toContain('Bloquear horario')
  })
})
