import { describe, expect, it } from 'vitest'
import {
  cancellationWarningText,
  resolveCancellationPolicy,
} from '@/lib/bookings/cancellation-policy'

describe('resolveCancellationPolicy', () => {
  const business = {
    selfServiceCutoffHours: 24,
    cancellationPolicy: 'Política actual',
  }

  it('usa el snapshot de la reserva aunque la configuración cambie después', () => {
    expect(resolveCancellationPolicy({
      cancellationCutoffHours: 48,
      cancellationPolicySnapshot: 'Política aceptada',
    }, business)).toEqual({
      cutoffHours: 48,
      additionalPolicy: 'Política aceptada',
    })
  })

  it('conserva un snapshot de política vacío en una reserva nueva', () => {
    expect(resolveCancellationPolicy({
      cancellationCutoffHours: 12,
      cancellationPolicySnapshot: null,
    }, business)).toEqual({
      cutoffHours: 12,
      additionalPolicy: null,
    })
  })

  it('usa la configuración actual sólo para reservas legacy sin snapshot de cutoff', () => {
    expect(resolveCancellationPolicy({
      cancellationCutoffHours: null,
      cancellationPolicySnapshot: null,
    }, business)).toEqual({
      cutoffHours: 24,
      additionalPolicy: 'Política actual',
    })
  })
})

describe('cancellationWarningText', () => {
  it('genera el copy contractual exacto en plural', () => {
    expect(cancellationWarningText(24)).toBe(
      'Podés cancelar o reprogramar hasta 24 horas antes. Con menos anticipación, el abono no se devuelve. Para cancelaciones anteriores aplica la política del negocio.',
    )
  })

  it('usa singular para una hora', () => {
    expect(cancellationWarningText(1)).toBe(
      'Podés cancelar o reprogramar hasta 1 hora antes. Con menos anticipación, el abono no se devuelve. Para cancelaciones anteriores aplica la política del negocio.',
    )
  })

  it('omite el warning cuando no existe cutoff', () => {
    expect(cancellationWarningText(0)).toBeNull()
  })
})
