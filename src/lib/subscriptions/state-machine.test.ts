import { describe, expect, it } from 'vitest'
import {
  deriveSubscriptionTransition,
  type SubscriptionState,
  type SubscriptionTransitionInput,
} from './state-machine'
import type { BillingClock } from './clock'

const NOW = new Date('2026-08-15T12:00:00.000Z')
const clock: BillingClock = { now: () => NOW }

function state(overrides: Partial<SubscriptionState> = {}): SubscriptionState {
  return {
    status: 'trialing',
    currentPeriodStart: new Date('2026-08-01T00:00:00.000Z'),
    currentPeriodEnd: new Date('2026-09-01T00:00:00.000Z'),
    trialStartAt: new Date('2026-08-01T00:00:00.000Z'),
    trialEndAt: new Date('2026-08-31T00:00:00.000Z'),
    cancelledAt: null,
    suspendedAt: null,
    suspendedReason: null,
    nextBillingAt: null,
    lastPaidAt: null,
    pastDueAt: null,
    graceEndsAt: null,
    graceDays: 7,
    cancelAtPeriodEnd: false,
    cancellationRequestedAt: null,
    complimentaryUntil: null,
    ...overrides,
  }
}

function transition(
  subscription: SubscriptionState,
  input: Omit<SubscriptionTransitionInput, 'subscription' | 'clock'>,
) {
  return deriveSubscriptionTransition({ subscription, clock, ...input })
}

describe('deriveSubscriptionTransition', () => {
  it.each([
    {
      name: 'trial vigente',
      subscription: state(),
      command: { type: 'time_elapsed', at: NOW, enforcementEnabled: true } as const,
      expected: 'trialing',
    },
    {
      name: 'exención vigente',
      subscription: state({
        trialEndAt: new Date('2026-08-10T00:00:00.000Z'),
        complimentaryUntil: new Date('2026-08-20T00:00:00.000Z'),
      }),
      command: { type: 'time_elapsed', at: NOW, enforcementEnabled: true } as const,
      expected: 'trialing',
    },
    {
      name: 'trial vencido sin autorización',
      subscription: state({ trialEndAt: new Date('2026-08-14T00:00:00.000Z') }),
      command: { type: 'time_elapsed', at: NOW, enforcementEnabled: true } as const,
      expected: 'past_due',
    },
    {
      name: 'fallo dentro de gracia',
      subscription: state({
        status: 'past_due',
        pastDueAt: new Date('2026-08-12T00:00:00.000Z'),
        graceEndsAt: new Date('2026-08-19T00:00:00.000Z'),
      }),
      command: { type: 'invoice_failed', occurredAt: NOW } as const,
      expected: 'past_due',
    },
    {
      name: 'aprobado durante gracia',
      subscription: state({
        status: 'past_due',
        pastDueAt: new Date('2026-08-12T00:00:00.000Z'),
        graceEndsAt: new Date('2026-08-19T00:00:00.000Z'),
      }),
      command: {
        type: 'invoice_approved',
        providerPaymentId: 'payment-approved',
        paidAt: NOW,
        periodEnd: new Date('2026-09-15T12:00:00.000Z'),
      } as const,
      expected: 'active',
    },
    {
      name: 'gracia vencida con enforcement off',
      subscription: state({
        status: 'past_due',
        graceEndsAt: new Date('2026-08-15T11:59:59.999Z'),
      }),
      command: { type: 'time_elapsed', at: NOW, enforcementEnabled: false } as const,
      expected: 'past_due',
    },
    {
      name: 'gracia vencida con enforcement on',
      subscription: state({
        status: 'past_due',
        graceEndsAt: new Date('2026-08-15T11:59:59.999Z'),
      }),
      command: { type: 'time_elapsed', at: NOW, enforcementEnabled: true } as const,
      expected: 'suspended',
    },
    {
      name: 'cancelAtPeriodEnd antes del cierre',
      subscription: state({ status: 'active', cancelAtPeriodEnd: true }),
      command: {
        type: 'time_elapsed',
        at: new Date('2026-08-31T23:59:59.999Z'),
        enforcementEnabled: true,
      } as const,
      expected: 'active',
    },
    {
      name: 'cancelAtPeriodEnd al cierre',
      subscription: state({ status: 'active', cancelAtPeriodEnd: true }),
      command: {
        type: 'time_elapsed',
        at: new Date('2026-09-01T00:00:00.000Z'),
        enforcementEnabled: true,
      } as const,
      expected: 'cancelled',
    },
  ])('$name -> $expected', ({ subscription, command, expected }) => {
    expect(transition(subscription, { command }).nextStatus).toBe(expected)
  })

  it('preserva el trial completo mientras la exención está vigente', () => {
    const trialStartAt = new Date('2026-08-10T00:00:00.000Z')
    const trialEndAt = new Date('2026-09-09T00:00:00.000Z')
    const result = transition(
      state({
        trialStartAt,
        trialEndAt,
        complimentaryUntil: new Date('2026-08-20T00:00:00.000Z'),
      }),
      { command: { type: 'time_elapsed', at: NOW, enforcementEnabled: true } },
    )

    expect(result.changes).not.toHaveProperty('trialStartAt')
    expect(result.changes).not.toHaveProperty('trialEndAt')
  })

  it('no inventa mora al vencer un trial con autorización cuyo cobro sigue pendiente', () => {
    const authorized = {
      ...state({ trialEndAt: new Date('2026-08-14T00:00:00.000Z') }),
      providerSubscriptionId: 'authorized-subscription',
    }
    const result = transition(authorized, {
      command: { type: 'time_elapsed', at: NOW, enforcementEnabled: true },
    })

    expect(result).toMatchObject({
      nextStatus: 'trialing',
      changes: {},
      auditAction: null,
      ignored: true,
    })
  })

  it('un pago duplicado no avanza el período ni genera otra auditoría', () => {
    const result = transition(state({ status: 'active' }), {
      command: {
        type: 'invoice_approved',
        providerPaymentId: 'payment-duplicate',
        paidAt: NOW,
        periodEnd: new Date('2026-10-01T00:00:00.000Z'),
      },
      paymentAlreadyApplied: true,
    })

    expect(result).toMatchObject({
      nextStatus: 'active',
      changes: {},
      auditAction: null,
      ignored: true,
    })
  })

  it('un fallo anterior al último cobro no degrada el estado nuevo', () => {
    const result = transition(
      state({
        status: 'active',
        lastPaidAt: new Date('2026-08-15T12:00:00.000Z'),
      }),
      {
        command: {
          type: 'invoice_failed',
          occurredAt: new Date('2026-08-15T11:59:59.999Z'),
        },
      },
    )

    expect(result).toMatchObject({
      nextStatus: 'active',
      changes: {},
      auditAction: null,
      ignored: true,
    })
  })

  it('un aprobado fuera de orden no reduce el período ya confirmado', () => {
    const currentPeriodEnd = new Date('2026-10-01T00:00:00.000Z')
    const result = transition(
      state({
        status: 'active',
        currentPeriodEnd,
        lastPaidAt: new Date('2026-08-15T12:00:00.000Z'),
      }),
      {
        command: {
          type: 'invoice_approved',
          providerPaymentId: 'payment-stale-period',
          paidAt: new Date('2026-08-16T12:00:00.000Z'),
          periodEnd: new Date('2026-09-01T00:00:00.000Z'),
        },
      },
    )

    expect(result).toMatchObject({
      nextStatus: 'active',
      changes: {},
      auditAction: null,
      ignored: true,
    })
  })

  it('conserva el inicio de gracia ante fallos repetidos', () => {
    const pastDueAt = new Date('2026-08-12T00:00:00.000Z')
    const graceEndsAt = new Date('2026-08-19T00:00:00.000Z')
    const result = transition(
      state({ status: 'past_due', pastDueAt, graceEndsAt }),
      { command: { type: 'invoice_failed', occurredAt: NOW } },
    )

    expect(result.changes).not.toHaveProperty('pastDueAt')
    expect(result.changes).not.toHaveProperty('graceEndsAt')
  })

  it('ancla la gracia al vencimiento real del trial, no a la hora del cron', () => {
    const trialEndAt = new Date('2026-08-14T00:00:00.000Z')
    const result = transition(state({ trialEndAt }), {
      command: { type: 'time_elapsed', at: NOW, enforcementEnabled: true },
    })

    expect(result.changes).toMatchObject({
      pastDueAt: trialEndAt,
      graceEndsAt: new Date('2026-08-21T00:00:00.000Z'),
    })
  })

  it('una cancelación confirmada por el proveedor termina acceso y renovación', () => {
    const occurredAt = new Date('2026-08-15T10:00:00.000Z')
    const result = transition(state({
      status: 'active',
      nextBillingAt: new Date('2026-09-01T00:00:00.000Z'),
    }), {
      command: { type: 'provider_cancelled', occurredAt },
    })

    expect(result).toMatchObject({
      nextStatus: 'cancelled',
      changes: { cancelledAt: occurredAt, nextBillingAt: null },
      auditAction: 'subscription_cancelled_by_provider',
      ignored: false,
    })
  })

  it('solicitar cancelación conserva acceso y registra el cierre diferido', () => {
    const requestedAt = new Date('2026-08-15T12:00:00.000Z')
    const result = transition(state({ status: 'active' }), {
      command: { type: 'cancel_at_period_end', requestedAt },
    })

    expect(result).toMatchObject({
      nextStatus: 'active',
      changes: { cancelAtPeriodEnd: true, cancellationRequestedAt: requestedAt },
      auditAction: 'subscription_cancellation_requested',
      ignored: false,
    })
  })
})
