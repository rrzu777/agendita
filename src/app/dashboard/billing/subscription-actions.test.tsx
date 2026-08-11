import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

const mocks = vi.hoisted(() => ({ useActionState: vi.fn() }))

vi.mock('react', async (importOriginal) => ({
  ...await importOriginal<typeof import('react')>(),
  useActionState: (...args: unknown[]) => mocks.useActionState(...args),
}))

vi.mock('@/server/actions/subscriptions', () => ({
  startSubscriptionAction: vi.fn(),
  cancelSubscriptionAction: vi.fn(),
}))

import { SubscriptionActions } from './subscription-actions'

describe('SubscriptionActions', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.useActionState.mockReturnValue([{ error: null }, vi.fn(), false])
  })

  it('disables activation while pending to prevent double submit', () => {
    mocks.useActionState
      .mockReturnValueOnce([{ error: null }, vi.fn(), true])
      .mockReturnValueOnce([{ error: null }, vi.fn(), false])

    const html = renderToStaticMarkup(
      <SubscriptionActions canStartCheckout canCancel={false} />,
    )

    expect(html).toContain('Abriendo Mercado Pago…')
    expect(html).toContain('disabled=""')
  })

  it('shows a sanitary inline error and re-enables retry after failure', () => {
    mocks.useActionState
      .mockReturnValueOnce([{ error: 'El estado cambió; reintenta.' }, vi.fn(), false])
      .mockReturnValueOnce([{ error: null }, vi.fn(), false])

    const html = renderToStaticMarkup(
      <SubscriptionActions canStartCheckout canCancel={false} />,
    )

    expect(html).toContain('El estado cambió; reintenta.')
    expect(html).toContain('Activar mensualidad automática')
    expect(html).not.toContain('disabled=""')
    expect(html).toContain('aria-live="polite"')
  })

  it('disables cancellation while pending', () => {
    mocks.useActionState
      .mockReturnValueOnce([{ error: null }, vi.fn(), false])
      .mockReturnValueOnce([{ error: null }, vi.fn(), true])

    const html = renderToStaticMarkup(
      <SubscriptionActions canStartCheckout={false} canCancel />,
    )

    expect(html).toContain('Cancelando renovación…')
    expect(html).toContain('disabled=""')
  })
})
