import { describe, it, expect } from 'vitest'
import { derivePackageConfirmationState, isPackageOfferUnchanged } from './package-confirmation-state'

describe('derivePackageConfirmationState', () => {
  it('active si la compra ya está activa', () => {
    expect(derivePackageConfirmationState({ status: 'active', payments: [] })).toBe('active')
  })
  it('active si hay un pago approved aunque la compra siga pending (carrera webhook/redirect)', () => {
    expect(derivePackageConfirmationState({ status: 'pending', payments: [{ status: 'approved', provider: 'mercado_pago' }] })).toBe('active')
  })
  it('pending mientras el pago está pending/in_process', () => {
    expect(derivePackageConfirmationState({ status: 'pending', payments: [{ status: 'pending', provider: 'mercado_pago' }] })).toBe('pending')
    expect(derivePackageConfirmationState({ status: 'pending', payments: [{ status: 'in_process', provider: 'mercado_pago' }] })).toBe('pending')
  })
  it('rejected si el único pago fue rechazado/cancelado', () => {
    expect(derivePackageConfirmationState({ status: 'pending', payments: [{ status: 'rejected', provider: 'mercado_pago' }] })).toBe('rejected')
  })
  it('pending si no hay pagos todavía', () => {
    expect(derivePackageConfirmationState({ status: 'pending', payments: [] })).toBe('pending')
  })
  it('expired si la compra venció (hold sin declarar)', () => {
    expect(derivePackageConfirmationState({ status: 'expired', payments: [] })).toBe('expired')
  })
  it('refunded si la compra fue reembolsada voluntariamente (sin chargebackAt)', () => {
    expect(derivePackageConfirmationState({ status: 'refunded', chargebackAt: null, payments: [] })).toBe('refunded')
  })
  it('disputed si la compra fue revertida por chargeback (chargebackAt set)', () => {
    expect(derivePackageConfirmationState({ status: 'refunded', chargebackAt: new Date('2026-07-12'), payments: [] })).toBe('disputed')
  })
  it('rejected si la compra quedó rejected (transferencia rechazada)', () => {
    expect(derivePackageConfirmationState({ status: 'rejected', payments: [] })).toBe('rejected')
  })
})

const base = { status: 'pending', paymentMethod: null as string | null, chargebackAt: null, payments: [] as { status: string; provider: string; providerPaymentId?: string | null }[] }

describe('derivePackageConfirmationState — awaiting_transfer', () => {
  it('pending + Transferencia sin declarar → awaiting_transfer', () => {
    expect(derivePackageConfirmationState({ ...base, paymentMethod: 'Transferencia' })).toBe('awaiting_transfer')
  })

  it('pending + Transferencia declarada → pending (en verificación)', () => {
    expect(derivePackageConfirmationState({
      ...base, paymentMethod: 'Transferencia',
      payments: [{ status: 'pending', provider: 'manual', providerPaymentId: 'bt-pkg-declared:pp1' }],
    })).toBe('pending')
  })

  it('pending + Transferencia pero con MP en vuelo → NO awaiting_transfer (espejo del where de reservas)', () => {
    expect(derivePackageConfirmationState({
      ...base, paymentMethod: 'Transferencia',
      payments: [{ status: 'pending', provider: 'mercado_pago', providerPaymentId: null }],
    })).toBe('pending')
  })

  it('pending + MP aprobado (webhook en camino) → active aunque el método diga Transferencia', () => {
    expect(derivePackageConfirmationState({
      ...base, paymentMethod: 'Transferencia',
      payments: [{ status: 'approved', provider: 'mercado_pago', providerPaymentId: 'mp1' }],
    })).toBe('active')
  })

  it('pending sin método (MP nunca iniciado) → pending, como hoy', () => {
    expect(derivePackageConfirmationState(base)).toBe('pending')
  })

  it('terminales mandan: expired con Transferencia sigue siendo expired', () => {
    expect(derivePackageConfirmationState({ ...base, status: 'expired', paymentMethod: 'Transferencia' })).toBe('expired')
  })
})

describe('isPackageOfferUnchanged (regla de revive)', () => {
  const purchase = { pricePaid: 50000 }

  it('retomable: producto activo al mismo precio', () => {
    expect(isPackageOfferUnchanged({ isActive: true, price: 50000 }, purchase)).toBe(true)
  })

  it('NO retomable si el precio cambió', () => {
    expect(isPackageOfferUnchanged({ isActive: true, price: 60000 }, purchase)).toBe(false)
  })

  it('NO retomable si el producto fue desactivado', () => {
    expect(isPackageOfferUnchanged({ isActive: false, price: 50000 }, purchase)).toBe(false)
  })
})
