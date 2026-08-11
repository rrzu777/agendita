import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

const mocks = vi.hoisted(() => ({
  getCurrentUserWithBusiness: vi.fn(),
  getCurrentSubscription: vi.fn(),
}))

vi.mock('@/lib/auth/user', () => ({
  getCurrentUserWithBusiness: (...args: unknown[]) => mocks.getCurrentUserWithBusiness(...args),
}))

vi.mock('@/server/actions/subscriptions', () => ({
  getCurrentSubscription: (...args: unknown[]) => mocks.getCurrentSubscription(...args),
  startSubscriptionAction: vi.fn(),
  cancelSubscriptionAction: vi.fn(),
}))

vi.mock('next/navigation', () => ({ redirect: vi.fn() }))

import BillingPage from './page'

const NOW = new Date('2026-08-11T12:00:00.000Z')

function subscription(overrides: Record<string, unknown> = {}) {
  return {
    id: 'subscription-1',
    status: 'active',
    plan: { name: 'Plan Pro', priceMonthly: 19_990 },
    trialStartAt: null,
    trialEndAt: null,
    currentPeriodStart: new Date('2026-08-01T00:00:00.000Z'),
    currentPeriodEnd: new Date('2026-09-01T00:00:00.000Z'),
    interval: 'monthly',
    complimentaryUntil: null,
    billingEnabled: true,
    hasProviderSubscription: true,
    nextBillingAt: new Date('2026-09-01T00:00:00.000Z'),
    pastDueAt: null,
    graceEndsAt: null,
    cancelAtPeriodEnd: false,
    ...overrides,
  }
}

async function render(input: {
  subscription?: ReturnType<typeof subscription>
  callback?: string
  businessStatus?: string
} = {}) {
  const value = input.subscription ?? subscription()
  mocks.getCurrentUserWithBusiness.mockResolvedValue({
    user: { id: 'user-1' },
    business: { subscriptionStatus: input.businessStatus ?? value.status },
  })
  mocks.getCurrentSubscription.mockResolvedValue({ subscription: value, payments: [] })
  return renderToStaticMarkup(await BillingPage({
    searchParams: Promise.resolve(input.callback ? { subscription: input.callback } : {}),
  }))
}

describe('owner subscription billing experience', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.setSystemTime(NOW)
  })

  it('explains the active trial and when automatic billing starts', async () => {
    const html = await render({ subscription: subscription({
      status: 'trialing',
      hasProviderSubscription: false,
      trialStartAt: new Date('2026-07-15T00:00:00.000Z'),
      trialEndAt: new Date('2026-08-14T12:00:00.000Z'),
      nextBillingAt: null,
    }) })

    expect(html).toContain('Período de prueba activo')
    expect(html).toContain('Activar mensualidad automática')
    expect(html).toContain('El primer cobro se realizará al terminar tu prueba')
  })

  it('does not offer or imply an immediate charge during a complimentary period', async () => {
    const html = await render({ subscription: subscription({
      status: 'trialing',
      hasProviderSubscription: false,
      complimentaryUntil: new Date('2026-09-15T00:00:00.000Z'),
      nextBillingAt: null,
    }) })

    expect(html).toContain('Exención activa')
    expect(html).toContain('No necesitas registrar un medio de pago')
    expect(html).not.toContain('En prueba')
    expect(html).not.toContain('Inicio de prueba')
    expect(html).not.toContain('Fin de prueba')
    expect(html).not.toContain('Periodo actual')
    expect(html).not.toContain('Período de prueba activo')
    expect(html).not.toContain('Tu prueba gratuita')
    expect(html).not.toContain('Activar mensualidad automática')
    expect(html).not.toContain('cobro inmediato')
  })

  it('shows activation required once trial or exemption has ended', async () => {
    const html = await render({ subscription: subscription({
      status: 'past_due',
      hasProviderSubscription: false,
      nextBillingAt: null,
      pastDueAt: new Date('2026-08-10T00:00:00.000Z'),
      graceEndsAt: new Date('2026-08-17T00:00:00.000Z'),
    }) })

    expect(html).toContain('Activación requerida')
    expect(html).toContain('Activar mensualidad automática')
    expect(html).toContain('Período de gracia hasta')
  })

  it.each([
    ['processing', 'Mercado Pago está procesando la autorización'],
    ['active', 'La confirmación final llegará por webhook o reconciliación'],
    ['failed', 'Tu suscripción local no fue modificada'],
  ])('keeps the %s callback provisional', async (callback, expected) => {
    expect(await render({ callback })).toContain(expected)
  })

  it('shows active automatic billing and its next charge', async () => {
    const html = await render()

    expect(html).toContain('Mensualidad automática activa')
    expect(html).toContain('Próximo cobro')
    expect(html).toContain('Cancelar al final del período')
  })

  it('shows the grace deadline for past due subscriptions', async () => {
    const html = await render({ subscription: subscription({
      status: 'past_due',
      pastDueAt: new Date('2026-08-10T00:00:00.000Z'),
      graceEndsAt: new Date('2026-08-17T00:00:00.000Z'),
    }) })

    expect(html).toContain('Pago pendiente')
    expect(html).toContain('Período de gracia hasta')
  })

  it('explains suspension without promising automatic reactivation', async () => {
    const html = await render({ subscription: subscription({ status: 'suspended' }) })

    expect(html).toContain('Cuenta suspendida')
    expect(html).toContain('Contacta a soporte')
  })

  it('explains cancellation at period end and hides repeat cancellation', async () => {
    const html = await render({ subscription: subscription({ cancelAtPeriodEnd: true }) })

    expect(html).toContain('Cancelación programada')
    expect(html).toContain('Mantendrás acceso hasta')
    expect(html).not.toContain('Cancelar al final del período')
  })

  it('renders cancelled as terminal without activation or cancellation actions', async () => {
    const html = await render({ subscription: subscription({
      status: 'cancelled',
      hasProviderSubscription: false,
      nextBillingAt: null,
    }) })

    expect(html).toContain('Suscripción cancelada')
    expect(html).not.toContain('Activar mensualidad automática')
    expect(html).not.toContain('Cancelar al final del período')
  })

  it('never renders provider identifiers returned by the safe read model', async () => {
    mocks.getCurrentUserWithBusiness.mockResolvedValue({
      user: { id: 'user-1' }, business: { subscriptionStatus: 'active' },
    })
    mocks.getCurrentSubscription.mockResolvedValue({
      subscription: subscription(),
      payments: [{
        id: 'payment-1', amount: 19_990, currency: 'CLP', paymentMethod: 'Tarjeta',
        status: 'approved', notes: null, paidAt: NOW, createdAt: NOW,
      }],
    })

    const html = renderToStaticMarkup(await BillingPage())
    expect(html).not.toContain('provider-subscription-secret')
    expect(html).not.toContain('provider-payment-secret')
  })
})
