import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'

const update = vi.hoisted(() => vi.fn().mockResolvedValue({ ok: false, error: 'La reserva cambió. Recarga e intenta de nuevo.' }))
vi.mock('@/server/actions/bookings', () => ({ updateBookingStatus: update }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }))
vi.mock('@/components/dashboard/booking-contact-buttons', () => ({ BookingContactButtons: () => null }))
import { BookingCard } from '@/app/dashboard/bookings/page'

describe('mobile reservation actions', () => {
  it.each([['confirmed', 'Completar', 'completed'], ['pending_confirmation', 'Aceptar', 'confirmed']])('announces failures for %s without losing the reservation', async (status, label, destination) => {
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    try {
      await act(async () => root.render(<BookingCard booking={{ id: 'b-1', bookingNumber: 1, status, startDateTime: new Date('2026-09-14T15:00:00Z'), depositPaid: 10000, depositRequired: 10000, finalAmount: 10000, paymentStatus: 'fully_paid', totalPrice: 10000, remainingBalance: 0, holdExpiresAt: null, modality: 'on_site', service: { name: 'Corte' }, professional: null, customer: { name: 'Ana', phone: null }, payments: [] }} businessCurrency="CLP" businessTimezone="America/Santiago" businessAddress={null} now={new Date('2026-09-13T15:00:00Z')} />))
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
})
