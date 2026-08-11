import { describe, expect, it } from 'vitest'
import {
  deriveSubscriptionTransition,
  type SubscriptionState,
  type SubscriptionTransitionInput,
} from './state-machine'

const NOW = new Date('2026-08-15T12:00:00.000Z')

type TestSubscriptionState = SubscriptionState & {
  interval: 'monthly' | 'yearly'
  trialDays: number
  graceEnforcementDeferredAt: Date | null
  providerSubscriptionId: string | null
}

function state(overrides: Partial<TestSubscriptionState> = {}): TestSubscriptionState {
  return {
    status: 'trialing',
    interval: 'monthly',
    currentPeriodStart: new Date('2026-08-01T00:00:00.000Z'),
    currentPeriodEnd: new Date('2026-09-01T00:00:00.000Z'),
    trialStartAt: new Date('2026-08-01T00:00:00.000Z'),
    trialEndAt: new Date('2026-08-31T00:00:00.000Z'),
    trialDays: 30,
    cancelledAt: null,
    suspendedAt: null,
    suspendedReason: null,
    nextBillingAt: null,
    lastPaidAt: null,
    pastDueAt: null,
    graceEndsAt: null,
    graceDays: 7,
    graceEnforcementDeferredAt: null,
    cancelAtPeriodEnd: false,
    cancellationRequestedAt: null,
    complimentaryUntil: null,
    providerSubscriptionId: null,
    ...overrides,
  }
}

function transition(
  subscription: SubscriptionState,
  input: Omit<SubscriptionTransitionInput, 'subscription'>,
) {
  return deriveSubscriptionTransition({ subscription, ...input })
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

  it('inicia el trial completo después de una exención más corta que las fechas originales', () => {
    const complimentaryUntil = new Date('2026-08-20T00:00:00.000Z')
    const result = transition(state({
      trialStartAt: new Date('2026-08-01T00:00:00.000Z'),
      trialEndAt: new Date('2026-08-31T00:00:00.000Z'),
      complimentaryUntil,
    }), {
      command: { type: 'time_elapsed', at: complimentaryUntil, enforcementEnabled: true },
    })

    expect(result).toMatchObject({
      nextStatus: 'trialing',
      changes: {
        trialStartAt: complimentaryUntil,
        trialEndAt: new Date('2026-09-19T00:00:00.000Z'),
        currentPeriodStart: complimentaryUntil,
        currentPeriodEnd: new Date('2026-09-19T00:00:00.000Z'),
      },
      auditAction: 'trial_started_after_complimentary',
      ignored: false,
    })
  })

  it('inicia el trial completo después de una exención más larga que las fechas originales', () => {
    const complimentaryUntil = new Date('2026-10-01T00:00:00.000Z')
    const result = transition(state({ complimentaryUntil }), {
      command: { type: 'time_elapsed', at: complimentaryUntil, enforcementEnabled: true },
    })

    expect(result.changes).toMatchObject({
      trialStartAt: complimentaryUntil,
      trialEndAt: new Date('2026-10-31T00:00:00.000Z'),
    })
    expect(result.nextStatus).toBe('trialing')
  })

  it('con trialDays cero inicia mora exactamente al terminar la exención', () => {
    const complimentaryUntil = new Date('2026-10-01T00:00:00.000Z')
    const result = transition(state({ complimentaryUntil, trialDays: 0 }), {
      command: { type: 'time_elapsed', at: complimentaryUntil, enforcementEnabled: true },
    })

    expect(result).toMatchObject({
      nextStatus: 'past_due',
      changes: {
        pastDueAt: complimentaryUntil,
        graceEndsAt: new Date('2026-10-08T00:00:00.000Z'),
      },
      auditAction: 'trial_expired',
    })
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

  it('usa el debitAt verificado como inicio de un ciclo perdido con aprobación tardía', () => {
    const result = transition(state({
      status: 'past_due',
      currentPeriodStart: new Date('2026-07-01T00:00:00.000Z'),
      currentPeriodEnd: new Date('2026-08-01T00:00:00.000Z'),
    }), {
      command: {
        type: 'invoice_approved',
        providerPaymentId: 'late-payment',
        paidAt: new Date('2026-09-10T00:00:00.000Z'),
        periodStart: new Date('2026-09-01T00:00:00.000Z'),
        periodEnd: new Date('2026-10-01T00:00:00.000Z'),
      },
    })

    expect(result).toMatchObject({
      nextStatus: 'active',
      changes: {
        currentPeriodStart: new Date('2026-09-01T00:00:00.000Z'),
        currentPeriodEnd: new Date('2026-10-01T00:00:00.000Z'),
        lastPaidAt: new Date('2026-09-10T00:00:00.000Z'),
      },
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

  it('un fallo del ciclo siguiente aplica aunque el pago anterior fuera aprobado tarde', () => {
    const result = transition(state({
      status: 'active',
      currentPeriodStart: new Date('2026-07-11T10:00:00.000Z'),
      currentPeriodEnd: new Date('2026-08-11T10:00:00.000Z'),
      lastPaidAt: new Date('2026-09-15T12:00:00.000Z'),
    }), {
      command: {
        type: 'invoice_failed',
        occurredAt: new Date('2026-08-11T10:00:00.000Z'),
      },
    })

    expect(result).toMatchObject({
      nextStatus: 'past_due',
      changes: {
        pastDueAt: new Date('2026-08-11T10:00:00.000Z'),
      },
      ignored: false,
    })
  })

  it('un ciclo aprobado posterior avanza aunque su approvedAt sea anterior al retry previo', () => {
    const latePreviousApproval = new Date('2026-09-15T12:00:00.000Z')
    const result = transition(state({
      status: 'active',
      currentPeriodStart: new Date('2026-07-11T10:00:00.000Z'),
      currentPeriodEnd: new Date('2026-08-11T10:00:00.000Z'),
      lastPaidAt: latePreviousApproval,
    }), {
      command: {
        type: 'invoice_approved',
        providerPaymentId: 'payment-next-cycle-earlier-approval',
        paidAt: new Date('2026-08-20T12:00:00.000Z'),
        periodStart: new Date('2026-08-11T10:00:00.000Z'),
        periodEnd: new Date('2026-09-11T10:00:00.000Z'),
      },
    })

    expect(result).toMatchObject({
      nextStatus: 'active',
      changes: {
        currentPeriodStart: new Date('2026-08-11T10:00:00.000Z'),
        currentPeriodEnd: new Date('2026-09-11T10:00:00.000Z'),
        lastPaidAt: latePreviousApproval,
      },
      ignored: false,
    })
  })

  it('un fallo nuevo no degrada una suscripción ya suspendida', () => {
    const result = transition(state({
      status: 'suspended',
      suspendedAt: new Date('2026-08-14T00:00:00.000Z'),
      suspendedReason: 'grace_period_expired',
    }), {
      command: { type: 'invoice_failed', occurredAt: NOW },
    })

    expect(result).toMatchObject({
      nextStatus: 'suspended',
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

  it('una cancelación confirmada por el proveedor difiere el cierre al fin del período', () => {
    const occurredAt = new Date('2026-08-15T10:00:00.000Z')
    const result = transition(state({
      status: 'active',
      nextBillingAt: new Date('2026-09-01T00:00:00.000Z'),
    }), {
      command: { type: 'provider_cancelled', occurredAt },
    })

    expect(result).toMatchObject({
      nextStatus: 'active',
      changes: {
        cancelAtPeriodEnd: true,
        cancellationRequestedAt: occurredAt,
      },
      auditAction: 'subscription_cancellation_requested_by_provider',
      ignored: false,
    })
  })

  it('un provider_cancelled tardío no corta el nuevo período ya pagado', () => {
    const paidPeriodEnd = new Date('2026-10-01T00:00:00.000Z')
    const cancelledAtProvider = new Date('2026-09-02T00:00:00.000Z')
    const requested = transition(state({
      status: 'active',
      currentPeriodStart: new Date('2026-09-01T00:00:00.000Z'),
      currentPeriodEnd: paidPeriodEnd,
      lastPaidAt: new Date('2026-09-01T00:00:00.000Z'),
    }), {
      command: { type: 'provider_cancelled', occurredAt: cancelledAtProvider },
    })

    const beforeEnd = transition(state({
      status: requested.nextStatus,
      currentPeriodEnd: paidPeriodEnd,
      ...requested.changes,
    }), {
      command: {
        type: 'time_elapsed',
        at: new Date('2026-09-30T23:59:59.999Z'),
        enforcementEnabled: true,
      },
    })

    expect(beforeEnd.nextStatus).toBe('active')
    expect(requested.changes).not.toHaveProperty('cancelledAt')
  })

  it('registra una sola vez la gracia vencida con enforcement apagado', () => {
    const graceEndsAt = new Date('2026-08-14T00:00:00.000Z')
    const first = transition(state({ status: 'past_due', graceEndsAt }), {
      command: { type: 'time_elapsed', at: NOW, enforcementEnabled: false },
    })
    const second = transition(state({
      status: first.nextStatus,
      graceEndsAt,
      ...first.changes,
    }), {
      command: {
        type: 'time_elapsed',
        at: new Date('2026-08-16T12:00:00.000Z'),
        enforcementEnabled: false,
      },
    })

    expect(first).toMatchObject({
      changes: { graceEnforcementDeferredAt: NOW },
      auditAction: 'grace_expired_unenforced',
      ignored: false,
    })
    expect(second).toMatchObject({ changes: {}, auditAction: null, ignored: true })
  })

  it('rechaza suscripciones yearly en el contrato mensual', () => {
    expect(() => transition(state({ interval: 'yearly' }), {
      command: { type: 'time_elapsed', at: NOW, enforcementEnabled: true },
    })).toThrow(/monthly/)
  })

  it('rechaza un periodEnd anual aunque la suscripción diga monthly', () => {
    expect(() => transition(state({
      status: 'active',
      currentPeriodEnd: new Date('2026-08-15T12:00:00.000Z'),
    }), {
      command: {
        type: 'invoice_approved',
        providerPaymentId: 'payment-annual-period',
        paidAt: NOW,
        periodEnd: new Date('2027-08-15T12:00:00.000Z'),
      },
    })).toThrow(/27.*32/)
  })

  it('no sustituye un periodStart autoritativo inválido por el período local', () => {
    expect(() => transition(state({
      status: 'active',
      currentPeriodEnd: new Date('2026-09-01T00:00:00.000Z'),
    }), {
      command: {
        type: 'invoice_approved',
        providerPaymentId: 'payment-invalid-authoritative-period',
        paidAt: new Date('2026-08-15T12:00:00.000Z'),
        periodStart: new Date('2026-08-15T12:00:00.000Z'),
        periodEnd: new Date('2026-10-01T00:00:00.000Z'),
      },
    })).toThrow(/27.*32/)
  })

  it('acepta un mes calendario desde 31 de enero hasta 28 de febrero', () => {
    const paidAt = new Date('2027-01-31T00:00:00.000Z')
    const result = transition(state({
      status: 'past_due',
      currentPeriodEnd: paidAt,
    }), {
      command: {
        type: 'invoice_approved',
        providerPaymentId: 'payment-end-of-month',
        paidAt,
        periodEnd: new Date('2027-02-28T00:00:00.000Z'),
      },
    })

    expect(result).toMatchObject({
      nextStatus: 'active',
      changes: {
        currentPeriodStart: paidAt,
        currentPeriodEnd: new Date('2027-02-28T00:00:00.000Z'),
      },
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
