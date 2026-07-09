import { renderToStaticMarkup } from 'react-dom/server'
import { describe, it, expect, vi } from 'vitest'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }))

import { ReviewRowActions } from '@/app/dashboard/reviews/reviews-client'

describe('ReviewRowActions', () => {
  it('shows Aprobar as primary + kebab trigger for a pending review', () => {
    const html = renderToStaticMarkup(
      <ReviewRowActions state="pending" isPending={false} onApprove={() => {}} onHide={() => {}} />,
    )
    expect(html).toContain('Aprobar')
    expect(html).toContain('Más acciones')
  })

  it('shows Ocultar as primary + kebab trigger for an approved review', () => {
    const html = renderToStaticMarkup(
      <ReviewRowActions state="approved" isPending={false} onApprove={() => {}} onHide={() => {}} />,
    )
    expect(html).toContain('Ocultar')
    expect(html).toContain('Más acciones')
  })

  it('shows Aprobar as primary + kebab trigger for a hidden review', () => {
    const html = renderToStaticMarkup(
      <ReviewRowActions state="hidden" isPending={false} onApprove={() => {}} onHide={() => {}} />,
    )
    expect(html).toContain('Aprobar')
    expect(html).toContain('Más acciones')
  })
})
