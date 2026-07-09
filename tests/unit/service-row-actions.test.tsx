import { isValidElement, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, it, expect, vi } from 'vitest'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }))

import { ServiceRowActions, DeactivateServiceDialog } from '@/components/dashboard/service-row-actions'

// Collect all string fragments found anywhere in a React element tree.
// Used to assert on Radix Dialog content that renderToStaticMarkup can't show
// (its content renders into a portal, so it never appears in the markup string).
function collectStrings(node: unknown, acc: string[] = []): string[] {
  if (typeof node === 'string') {
    acc.push(node)
    return acc
  }
  if (Array.isArray(node)) {
    node.forEach((child) => collectStrings(child, acc))
    return acc
  }
  if (isValidElement(node)) {
    const el = node as ReactElement<{ children?: unknown }>
    if (el.props && 'children' in el.props) collectStrings(el.props.children, acc)
  }
  return acc
}

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

  // Guards the hoisted deactivation confirmation dialog. Its content is
  // portal-rendered by Radix, so renderToStaticMarkup emits nothing for it;
  // we inspect the returned element tree instead. DeactivateServiceDialog is a
  // pure component (no hooks) so it can be called directly. This fails if the
  // confirmation copy or the service name interpolation is removed.
  it('confirmation dialog shows the desactivar title and the service name', () => {
    const tree = DeactivateServiceDialog({
      service: rowService() as never,
      loading: false,
      open: true,
      onOpenChange: () => {},
      onConfirm: () => {},
    })
    const strings = collectStrings(tree).join(' ')
    expect(strings).toContain('Desactivar servicio')
    expect(strings).toContain('Manicura semipermanente')
  })
})
