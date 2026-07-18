import { describe, it, expect } from 'vitest'
import {
  BT_DECLARED_PREFIX, BT_BALANCE_PREFIX, BT_PKG_DECLARED_PREFIX,
  btDeclaredId, btBalanceId, btPkgDeclaredId,
  declaredTransferPaymentWhere, declaredBalancePaymentWhere, declaredPkgTransferPaymentWhere,
  isDeclaredTransferPayment, isDeclaredBalancePayment, isDeclaredPkgTransferPayment,
} from '@/lib/bank-transfer/declared'

// Las 3 familias salen de la misma fábrica (makeDeclaredTransferKind). Estos
// tests fijan el invariante que un factory podría romper: cada familia cableada
// a SU prefijo, sin cruces. Los tests por-familia (bank-transfer-declared.test.ts,
// bt-pkg-declared.test.ts) quedan intactos como prueba de "sin cambio de conducta".
const FAMILIES = [
  { name: 'abono', prefix: BT_DECLARED_PREFIX, id: btDeclaredId, where: declaredTransferPaymentWhere, is: isDeclaredTransferPayment },
  { name: 'saldo', prefix: BT_BALANCE_PREFIX, id: btBalanceId, where: declaredBalancePaymentWhere, is: isDeclaredBalancePayment },
  { name: 'paquete', prefix: BT_PKG_DECLARED_PREFIX, id: btPkgDeclaredId, where: declaredPkgTransferPaymentWhere, is: isDeclaredPkgTransferPayment },
]

describe('familias de transferencia declarada (factory)', () => {
  it.each(FAMILIES)('$name: id, where y predicado cablean su propio prefijo', (fam) => {
    expect(fam.id('e1')).toBe(`${fam.prefix}e1`)
    expect(fam.where).toEqual({ provider: 'manual', status: 'pending', providerPaymentId: { startsWith: fam.prefix } })
    expect(fam.is({ provider: 'manual', status: 'pending', providerPaymentId: fam.id('e1') })).toBe(true)
  })

  it.each(FAMILIES)('$name: el predicado exige manual + pending', (fam) => {
    const ok = { provider: 'manual', status: 'pending', providerPaymentId: fam.id('e1') }
    expect(fam.is({ ...ok, provider: 'mercado_pago' })).toBe(false)
    expect(fam.is({ ...ok, status: 'approved' })).toBe(false)
    expect(fam.is({ ...ok, providerPaymentId: null })).toBe(false)
  })

  it('las 3 familias son mutuamente disjuntas (ningún id/predicado cruza)', () => {
    for (const a of FAMILIES) {
      for (const b of FAMILIES) {
        if (a === b) continue
        const payment = { provider: 'manual', status: 'pending', providerPaymentId: a.id('e1') }
        expect(b.is(payment)).toBe(false)
        expect(a.id('e1').startsWith(b.prefix)).toBe(false)
      }
    }
  })
})
