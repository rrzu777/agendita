import { describe, it, expect } from 'vitest'
import {
  assertBusinessCanReceiveBookings,
  getSubscriptionStatusLabel,
} from '@/lib/subscriptions/enforcement'
import type { SubscriptionStatus } from '@prisma/client'

describe('subscription enforcement', () => {
  describe('assertBusinessCanReceiveBookings', () => {
    const allowedStatuses: SubscriptionStatus[] = ['trialing', 'active', 'past_due']
    const blockedStatuses: SubscriptionStatus[] = ['suspended', 'cancelled']

    it.each(allowedStatuses)('allows bookings when status is %s', (status) => {
      expect(() => assertBusinessCanReceiveBookings(status)).not.toThrow()
    })

    it.each(blockedStatuses)('rejects bookings when status is %s', (status) => {
      expect(() => assertBusinessCanReceiveBookings(status)).toThrow()
    })

    it('suspended message mentions suspension', () => {
      expect(() => assertBusinessCanReceiveBookings('suspended')).toThrow(
        'suspendido'
      )
    })

    it('cancelled message mentions no longer accepting', () => {
      expect(() => assertBusinessCanReceiveBookings('cancelled')).toThrow(
        'ya no acepta'
      )
    })
  })

  describe('getSubscriptionStatusLabel', () => {
    it('returns human-readable labels', () => {
      expect(getSubscriptionStatusLabel('trialing')).toBe('En prueba')
      expect(getSubscriptionStatusLabel('active')).toBe('Activo')
      expect(getSubscriptionStatusLabel('past_due')).toBe('Pago pendiente')
      expect(getSubscriptionStatusLabel('suspended')).toBe('Suspendido')
      expect(getSubscriptionStatusLabel('cancelled')).toBe('Cancelado')
    })
  })
})
