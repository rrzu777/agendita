import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }))

import { BookingRowActions } from '@/components/dashboard/booking-row-actions'
import { LedgerTable } from '@/components/dashboard/ledger-table'
import { PaymentForm } from '@/components/dashboard/payment-form'

const now = new Date('2026-08-01T12:00:00Z')
const paymentBooking = {
  id: 'booking-1',
  bookingNumber: 4738,
  status: 'confirmed',
  depositPaid: 10000,
  depositRequired: 10000,
  finalAmount: 30000,
  remainingBalance: 20000,
  holdExpiresAt: null,
  paymentStatus: 'unpaid',
  service: { name: 'Manicura' },
  customer: { name: 'Ana' },
}

describe('dashboard microtour targets', () => {
  let container: HTMLDivElement | null = null
  let root: Root | null = null

  afterEach(async () => {
    await act(async () => root?.unmount())
    container?.remove()
    container = null
    root = null
  })

  it('places the payment target on the existing flex child trigger', async () => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    await act(async () => root?.render(
      <div data-testid="payment-actions" className="flex items-end gap-3">
        <PaymentForm bookings={[paymentBooking as never]} now={now} />
        <button type="button">Exportar</button>
      </div>,
    ))

    const actions = container.querySelector('[data-testid="payment-actions"]') as HTMLElement
    const trigger = actions.querySelector('[data-tour-id="payments-register"]')
    expect(actions.firstElementChild).toBe(trigger)
    expect(trigger?.tagName).toBe('BUTTON')
  })

  it('renders a visible-responsive history target and an empty fallback', () => {
    const history = renderToStaticMarkup(<LedgerTable entries={[{
      id: 'entry-1',
      type: 'manual_income',
      direction: 'income',
      amount: 10000,
      occurredAt: now,
      description: 'Pago manual',
    }]} currency="CLP" />)
    const empty = renderToStaticMarkup(<LedgerTable entries={[]} currency="CLP" />)

    expect(history).toMatch(/data-tour-id="payments-history"[^>]*lg:hidden/)
    expect(history).toMatch(/data-tour-id="payments-history"[^>]*lg:block/)
    expect(empty).toContain('data-tour-id="payments-history-empty"')
  })

  it('leaves terminal booking rows without an action target for the definition fallback', () => {
    const terminal = renderToStaticMarkup(
      <BookingRowActions
        booking={{ ...paymentBooking, status: 'completed', remainingBalance: 0 } as never}
        businessCurrency="CLP"
        now={now}
      />,
    )

    expect(terminal).not.toContain('data-tour-id="bookings-actions"')
  })
})
