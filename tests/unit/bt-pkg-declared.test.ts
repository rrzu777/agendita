import { describe, it, expect } from 'vitest'
import {
  BT_PKG_DECLARED_PREFIX,
  btPkgDeclaredId,
  declaredPkgTransferPaymentWhere,
  isDeclaredPkgTransferPayment,
  BT_DECLARED_PREFIX,
} from '@/lib/bank-transfer/declared'

describe('bt-pkg-declared', () => {
  it('el id de paquete NO satisface el prefijo de abono de reserva', () => {
    const id = btPkgDeclaredId('pp1')
    expect(id).toBe('bt-pkg-declared:pp1')
    expect(id.startsWith(BT_DECLARED_PREFIX)).toBe(false) // clave: no lo barre el sweep booking-scoped
  })
  it('isDeclaredPkgTransferPayment matchea manual+pending+prefijo', () => {
    expect(isDeclaredPkgTransferPayment({ provider: 'manual', status: 'pending', providerPaymentId: btPkgDeclaredId('x') })).toBe(true)
    expect(isDeclaredPkgTransferPayment({ provider: 'manual', status: 'pending', providerPaymentId: 'bt-declared:x' })).toBe(false)
  })
  it('BT_PKG_DECLARED_PREFIX usable en where', () => {
    expect(declaredPkgTransferPaymentWhere.providerPaymentId).toEqual({ startsWith: BT_PKG_DECLARED_PREFIX })
  })
})
