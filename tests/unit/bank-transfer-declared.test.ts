import { describe, it, expect } from 'vitest'
import {
  BT_BALANCE_PREFIX, btBalanceId, declaredBalancePaymentWhere,
  isDeclaredBalancePayment, hasPendingBalanceTransfer, anyDeclaredTransferWhere,
  isDeclaredTransferPayment, hasPendingDeclaredTransfer, BT_DECLARED_PREFIX,
} from '@/lib/bank-transfer/declared'

const balPending = { provider: 'manual', status: 'pending', providerPaymentId: 'bt-balance:b1' }
const depPending = { provider: 'manual', status: 'pending', providerPaymentId: 'bt-declared:b1' }

describe('bt-balance helpers', () => {
  it('btBalanceId es determinístico y NO colisiona con bt-declared', () => {
    expect(btBalanceId('b1')).toBe('bt-balance:b1')
    expect(btBalanceId('b1').startsWith(BT_DECLARED_PREFIX)).toBe(false)
    expect(BT_BALANCE_PREFIX.startsWith(BT_DECLARED_PREFIX)).toBe(false)
  })
  it('isDeclaredBalancePayment discrimina por prefijo/status/provider', () => {
    expect(isDeclaredBalancePayment(balPending)).toBe(true)
    expect(isDeclaredBalancePayment(depPending)).toBe(false)
    expect(isDeclaredBalancePayment({ ...balPending, status: 'approved' })).toBe(false)
    expect(isDeclaredBalancePayment({ ...balPending, provider: 'mercado_pago' })).toBe(false)
  })
  it('los predicados de booking discriminan por prefijo y status', () => {
    const confirmed = { status: 'confirmed', payments: [balPending] }
    expect(hasPendingBalanceTransfer(confirmed)).toBe(true)
    expect(hasPendingDeclaredTransfer(confirmed)).toBe(false)
    expect(hasPendingBalanceTransfer({ status: 'completed', payments: [balPending] })).toBe(true)
    const pending = { status: 'pending_payment', payments: [depPending] }
    expect(hasPendingDeclaredTransfer(pending)).toBe(true)
    expect(hasPendingBalanceTransfer(pending)).toBe(false)
    expect(hasPendingDeclaredTransfer({ status: 'pending_payment', payments: [balPending, depPending] })).toBe(true)
  })
  it('declaredBalancePaymentWhere filtra manual+pending por prefijo de saldo', () => {
    expect(declaredBalancePaymentWhere.provider).toBe('manual')
    expect(declaredBalancePaymentWhere.status).toBe('pending')
    expect(declaredBalancePaymentWhere.providerPaymentId.startsWith).toBe('bt-balance:')
  })
  it('anyDeclaredTransferWhere cubre ambos prefijos', () => {
    expect(anyDeclaredTransferWhere.provider).toBe('manual')
    expect(anyDeclaredTransferWhere.status).toBe('pending')
    const ors = anyDeclaredTransferWhere.OR.map((o) => o.providerPaymentId.startsWith)
    expect(ors).toContain('bt-declared:')
    expect(ors).toContain('bt-balance:')
  })
  it('los helpers de abono existentes no cambian de semántica', () => {
    expect(isDeclaredTransferPayment(depPending)).toBe(true)
    expect(isDeclaredTransferPayment(balPending)).toBe(false)
  })
})
