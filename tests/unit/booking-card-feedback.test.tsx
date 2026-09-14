import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'

const update = vi.hoisted(() => vi.fn().mockResolvedValue({ ok: false, error: 'La reserva cambió. Recarga e intenta de nuevo.' }))
vi.mock('@/server/actions/bookings', () => ({ updateBookingStatus: update }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }))
import { BookingCard } from '@/app/dashboard/bookings/page'

const NOW = new Date('2026-09-13T15:00:00Z')

function booking(status: string, overrides: Record<string, unknown> = {}) {
  return {
    id: 'b-1',
    bookingNumber: 1,
    status,
    startDateTime: new Date('2026-09-14T15:00:00Z'),
    depositPaid: 10000,
    depositRequired: 10000,
    finalAmount: 20000,
    paymentStatus: 'deposit_paid',
    totalPrice: 20000,
    remainingBalance: 10000,
    holdExpiresAt: null,
    modality: 'on_site' as const,
    service: { name: 'Corte' },
    professional: null,
    customer: { name: 'Ana', phone: '+56912345678' },
    payments: [],
    ...overrides,
  }
}

async function openActionsMenu(container: HTMLElement) {
  const trigger = container.querySelector<HTMLButtonElement>('button[aria-label="Más acciones"]')!
  await act(async () => {
    trigger.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }))
    await Promise.resolve()
  })
  return document.body.querySelector<HTMLElement>('[data-slot="dropdown-menu-content"]')!
}

describe('mobile reservation actions', () => {
  it.each([['confirmed', 'Completar', 'completed'], ['pending_confirmation', 'Aceptar', 'confirmed']])('announces failures for %s without losing the reservation', async (status, label, destination) => {
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    try {
      await act(async () => root.render(<BookingCard booking={booking(status, { finalAmount: 10000, paymentStatus: 'fully_paid', totalPrice: 10000, remainingBalance: 0, customer: { name: 'Ana', phone: null } })} businessCurrency="CLP" businessTimezone="America/Santiago" businessAddress={null} now={NOW} />))
      const button = [...container.querySelectorAll('button')].find((button) => button.textContent === label)!
      expect(button.closest('form')).toBeNull()
      await act(async () => button.click())
      expect(update).toHaveBeenCalledWith('b-1', destination)
      expect(container.querySelector('[role="alert"]')?.textContent).toContain('La reserva cambió')
      expect(container.querySelector('article')?.textContent).toContain('Ana')
    } finally {
      await act(async () => root.unmount())
      container.remove()
    }
  })

  it.each([
    ['confirmed', 'Completar'],
    ['pending_payment', 'Cobrar'],
    ['pending_confirmation', 'Aceptar'],
    ['expired', 'Revivir'],
    ['cancelled', null],
    ['completed', null],
    ['no_show', null],
  ])('uses the shared primary-plus-overflow controller on mobile for %s', async (status, primaryLabel) => {
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    try {
      await act(async () => root.render(<BookingCard
        booking={booking(status, { remainingBalance: status === 'completed' ? 0 : 10000 })}
        businessCurrency="CLP"
        businessTimezone="America/Santiago"
        businessAddress={null}
        transferEnabled
        now={NOW}
      />))

      expect(container.querySelectorAll('[data-tour-id="bookings-actions"]')).toHaveLength(1)
      const primary = container.querySelector('[data-slot="table-actions-primary"]')?.textContent ?? null
      expect(primary).toBe(primaryLabel)
      expect(container.querySelectorAll('button[aria-label="Más acciones"]')).toHaveLength(1)

      const menu = await openActionsMenu(container)
      expect(menu.textContent).toContain('Copiar resumen')
      if (status !== 'confirmed') {
        expect(menu.textContent).not.toContain('Enviar confirmación')
        expect(menu.textContent).not.toContain('Enviar recordatorio')
      }
    } finally {
      await act(async () => root.unmount())
      container.remove()
    }
  })
})
