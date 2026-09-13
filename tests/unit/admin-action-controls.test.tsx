import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AdminActions } from '@/app/admin/businesses/[businessId]/admin-actions'
import { AdminSubscriptionControls } from '@/app/admin/businesses/[businessId]/admin-subscription-controls'

const { mockSuspend, mockConfigure, mockRefresh } = vi.hoisted(() => ({
  mockSuspend: vi.fn(), mockConfigure: vi.fn(), mockRefresh: vi.fn(),
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mockRefresh }) }))
vi.mock('@/server/actions/admin', () => ({
  adminSuspendBusiness: mockSuspend,
  adminActivateBusiness: vi.fn(), adminRecordSubscriptionPayment: vi.fn(),
  adminMarkPastDue: vi.fn(), adminCancelSubscription: vi.fn(),
  adminConfigureBilling: mockConfigure, adminSetComplimentaryPeriod: vi.fn(),
  adminClearComplimentaryPeriod: vi.fn(), adminReconcileSubscription: vi.fn(),
}))

function button(scope: ParentNode, label: string) {
  const match = Array.from(scope.querySelectorAll('button')).find((item) => item.textContent?.trim() === label)
  if (!match) throw new Error(`Button not found: ${label}`)
  return match
}

function deferred<T>() {
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((_resolve, rejectPromise) => { reject = rejectPromise })
  return { promise, reject }
}

describe('administrative confirmation controls', () => {
  let container: HTMLDivElement
  let root: Root
  beforeEach(() => {
    container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container)
    mockSuspend.mockReset(); mockConfigure.mockReset(); mockRefresh.mockReset()
  })
  afterEach(async () => { await act(async () => root.unmount()); container.remove() })

  it('opens, cancels with focus restoration, and reports a failed suspend without external effects', async () => {
    await act(async () => root.render(<AdminActions businessId="biz-1" businessName="Mimos" currentStatus="active" />))
    const trigger = button(container, 'Suspender negocio')
    await act(async () => trigger.click())
    let dialog = document.body.querySelector<HTMLElement>('[role="dialog"]')!
    const safe = button(dialog, 'Volver')
    const confirm = button(dialog, 'Suspender negocio')
    expect(safe.getAttribute('data-size')).toBe('form')
    expect(confirm.getAttribute('data-size')).toBe('form')
    expect(document.activeElement).toBe(safe)
    await act(async () => { safe.click(); await new Promise((resolve) => setTimeout(resolve, 0)) })
    expect(document.body.querySelector('[role="dialog"]')).toBeNull()
    expect(document.activeElement).toBe(trigger)

    const pending = deferred<never>(); mockSuspend.mockReturnValue(pending.promise)
    await act(async () => trigger.click())
    dialog = document.body.querySelector<HTMLElement>('[role="dialog"]')!
    await act(async () => button(dialog, 'Suspender negocio').click())
    expect(button(dialog, 'Procesando…').hasAttribute('disabled')).toBe(true)
    await act(async () => pending.reject(new Error('No autorizado')))
    expect(mockSuspend).toHaveBeenCalledWith('biz-1', undefined)
    expect(container.textContent).toContain('No autorizado')
    expect(mockRefresh).not.toHaveBeenCalled()
  })

  it('opens/cancels configuration and exposes pending failure recovery with 44px actions', async () => {
    const subscription = { status: 'active', environment: 'sandbox', trialDays: 30, trialEndAt: null, graceDays: 7, pastDueAt: null, graceEndsAt: null, complimentaryUntil: null, complimentaryReason: null, nextBillingAt: null, cancelAtPeriodEnd: false, currentPeriodEnd: '2026-10-01T00:00:00Z', lastReconciledAt: null, billingEnabled: false, planId: 'plan-1' }
    await act(async () => root.render(<AdminSubscriptionControls businessId="biz-1" timezone="America/Santiago" plans={[{ id: 'plan-1', name: 'Base', priceMonthly: 10000 }]} subscription={subscription} />))
    const trigger = button(container, 'Guardar configuración')
    await act(async () => trigger.click())
    let dialog = document.body.querySelector<HTMLElement>('[role="dialog"]')!
    const safe = button(dialog, 'Volver')
    expect(safe.getAttribute('data-size')).toBe('form')
    expect(button(dialog, 'Confirmar acción').getAttribute('data-size')).toBe('form')
    expect(document.activeElement).toBe(safe)
    await act(async () => safe.click())
    expect(document.activeElement).toBe(trigger)

    const pending = deferred<never>(); mockConfigure.mockReturnValue(pending.promise)
    await act(async () => trigger.click())
    dialog = document.body.querySelector<HTMLElement>('[role="dialog"]')!
    await act(async () => button(dialog, 'Confirmar acción').click())
    expect(button(dialog, 'Procesando…').hasAttribute('disabled')).toBe(true)
    await act(async () => pending.reject(new Error('Proveedor no disponible')))
    expect(mockConfigure).toHaveBeenCalledWith('biz-1', { planId: 'plan-1', trialDays: 30, graceDays: 7, billingEnabled: false })
    expect(container.textContent).toContain('Proveedor no disponible')
    expect(mockRefresh).not.toHaveBeenCalled()
  })
})
