import { describe, it, expect, vi } from 'vitest'
import { assertBusinessCanReceiveBookings } from '@/lib/subscriptions/enforcement'
import type { SubscriptionStatus } from '@prisma/client'

describe('assertBusinessCanReceiveBookings', () => {
  it('allows trialing businesses', () => {
    expect(() => assertBusinessCanReceiveBookings('trialing')).not.toThrow()
  })

  it('allows active businesses', () => {
    expect(() => assertBusinessCanReceiveBookings('active')).not.toThrow()
  })

  it('allows past_due businesses during beta', () => {
    expect(() => assertBusinessCanReceiveBookings('past_due')).not.toThrow()
  })

  it('blocks suspended businesses', () => {
    expect(() => assertBusinessCanReceiveBookings('suspended')).toThrow('suspendido')
  })

  it('blocks cancelled businesses', () => {
    expect(() => assertBusinessCanReceiveBookings('cancelled')).toThrow('ya no acepta')
  })
})
