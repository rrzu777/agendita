import { describe, it, expect, vi, beforeEach } from 'vitest'
const getCurrentUser = vi.fn()
vi.mock('@/lib/auth/user', () => ({ getCurrentUser: () => getCurrentUser() }))
const findFirst = vi.fn()
vi.mock('@/lib/db', () => ({ prisma: { customer: { findFirst: (...a: unknown[]) => findFirst(...a) } } }))
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: vi.fn().mockResolvedValue({ success: true }) }))
vi.mock('@/lib/customers/find-or-create', () => ({ findOrCreateCustomerInTx: vi.fn() }))
vi.mock('@/lib/payments/factory', () => ({ resolveOnlinePaymentAvailabilityForBusiness: vi.fn() }))

import { getPackageCheckoutPrefill } from './packages-checkout'

describe('getPackageCheckoutPrefill', () => {
  beforeEach(() => { getCurrentUser.mockReset(); findFirst.mockReset() })
  it('null sin sesión', async () => {
    getCurrentUser.mockResolvedValue(null)
    expect(await getPackageCheckoutPrefill('b1')).toBeNull()
  })
  it('prefill desde Customer linkeado', async () => {
    getCurrentUser.mockResolvedValue({ id: 'u1', email: 'ana@x.cl', user_metadata: { name: 'Ana Meta' } })
    findFirst.mockResolvedValue({ name: 'Ana Cliente', phone: '+56911112222' })
    const p = await getPackageCheckoutPrefill('b1')
    expect(p).toEqual({ email: 'ana@x.cl', name: 'Ana Cliente', phone: '+56911112222', hasCustomer: true })
  })
  it('sin Customer: usa nombre del metadata y phone vacío', async () => {
    getCurrentUser.mockResolvedValue({ id: 'u1', email: 'ana@x.cl', user_metadata: { name: 'Ana Meta' } })
    findFirst.mockResolvedValue(null)
    const p = await getPackageCheckoutPrefill('b1')
    expect(p).toEqual({ email: 'ana@x.cl', name: 'Ana Meta', phone: '', hasCustomer: false })
  })
})
