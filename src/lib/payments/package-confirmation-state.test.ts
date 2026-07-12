import { describe, it, expect } from 'vitest'
import { derivePackageConfirmationState } from './package-confirmation-state'

describe('derivePackageConfirmationState', () => {
  it('active si la compra ya está activa', () => {
    expect(derivePackageConfirmationState({ status: 'active', payments: [] })).toBe('active')
  })
  it('active si hay un pago approved aunque la compra siga pending (carrera webhook/redirect)', () => {
    expect(derivePackageConfirmationState({ status: 'pending', payments: [{ status: 'approved' }] })).toBe('active')
  })
  it('pending mientras el pago está pending/in_process', () => {
    expect(derivePackageConfirmationState({ status: 'pending', payments: [{ status: 'pending' }] })).toBe('pending')
    expect(derivePackageConfirmationState({ status: 'pending', payments: [{ status: 'in_process' }] })).toBe('pending')
  })
  it('rejected si el único pago fue rechazado/cancelado', () => {
    expect(derivePackageConfirmationState({ status: 'pending', payments: [{ status: 'rejected' }] })).toBe('rejected')
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
