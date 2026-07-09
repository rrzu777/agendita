import { renderToStaticMarkup } from 'react-dom/server'
import { describe, it, expect, vi } from 'vitest'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }))

import { ServiceRowActions } from '@/components/dashboard/service-row-actions'

function rowService(overrides: Record<string, unknown> = {}) {
  return {
    id: 's1',
    name: 'Manicura semipermanente',
    description: 'Incluye esmaltado',
    durationMinutes: 60,
    price: 15000,
    depositAmount: 5000,
    pastelColor: '#FFB3BA',
    isActive: true,
    sortOrder: 0,
    ...overrides,
  }
}

describe('ServiceRowActions', () => {
  it('shows Editar as primary + kebab trigger for an active service', () => {
    const html = renderToStaticMarkup(
      <ServiceRowActions
        service={rowService() as never}
        loading={false}
        onToggle={() => {}}
        onDeactivate={() => {}}
        onSuccess={() => {}}
      />,
    )
    expect(html).toContain('Editar')
    expect(html).toContain('Más acciones')
  })

  it('shows Editar as primary + kebab trigger for an inactive service', () => {
    const html = renderToStaticMarkup(
      <ServiceRowActions
        service={rowService({ isActive: false }) as never}
        loading={false}
        onToggle={() => {}}
        onDeactivate={() => {}}
        onSuccess={() => {}}
      />,
    )
    expect(html).toContain('Editar')
    expect(html).toContain('Más acciones')
  })
})
