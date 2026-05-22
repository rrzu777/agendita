import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PaymentStatus, BookingStatus } from '@prisma/client'

const mockPrisma = {
  customer: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    update: vi.fn(),
  },
  payment: {
    groupBy: vi.fn(),
    aggregate: vi.fn(),
    findMany: vi.fn(),
  },
  booking: {
    groupBy: vi.fn(),
    aggregate: vi.fn(),
    findMany: vi.fn(),
  },
}

const mockRequireBusiness = vi.fn()
const mockRequireBusinessRole = vi.fn()
const mockCheckRateLimit = vi.fn()
const mockRevalidatePath = vi.fn()

vi.mock('@/lib/db', () => ({
  prisma: mockPrisma,
}))

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: mockCheckRateLimit,
}))

vi.mock('@/lib/auth/server', () => ({
  requireBusiness: mockRequireBusiness,
  requireBusinessRole: mockRequireBusinessRole,
  ForbiddenError: class ForbiddenError extends Error {
    constructor(message = 'No tienes permisos') {
      super(message)
      this.name = 'ForbiddenError'
    }
  },
}))

vi.mock('next/cache', () => ({
  revalidatePath: mockRevalidatePath,
}))

const {
  getCustomers,
  getCustomerDetail,
  updateCustomer,
  updateCustomerNotes,
} = await import('@/server/actions/customers')

const businessId = 'biz-1'

const mockCustomers = [
  {
    id: 'cust-1',
    businessId,
    name: 'Maria Garcia',
    phone: '56912345678',
    email: 'maria@test.com',
    notes: 'Prefiere manana',
    createdAt: new Date('2024-03-01'),
    updatedAt: new Date('2024-03-01'),
  },
  {
    id: 'cust-2',
    businessId,
    name: 'Ana Lopez',
    phone: '56987654321',
    email: null,
    notes: null,
    createdAt: new Date('2024-06-01'),
    updatedAt: new Date('2024-06-01'),
  },
]

const mockPaymentAggregates = [
  { customerId: 'cust-1', _sum: { amount: 30000 } },
  { customerId: 'cust-2', _sum: { amount: 15000 } },
]

const mockBookingStats = [
  {
    customerId: 'cust-1',
    _count: { id: 3 },
    _max: { startDateTime: new Date('2024-07-15') },
  },
  {
    customerId: 'cust-2',
    _count: { id: 1 },
    _max: { startDateTime: new Date('2024-06-10') },
  },
]

const mockPendingBalanceAggregates = [
  { customerId: 'cust-1', _sum: { remainingBalance: 10000 } },
  { customerId: 'cust-2', _sum: { remainingBalance: 0 } },
]

describe('customers actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckRateLimit.mockResolvedValue({ success: true })
    mockRequireBusiness.mockResolvedValue({ businessId })
    mockRequireBusinessRole.mockResolvedValue({ businessId })
  })

  describe('getCustomers', () => {
    beforeEach(() => {
      mockPrisma.customer.findMany.mockResolvedValue(mockCustomers)
      mockPrisma.payment.groupBy.mockResolvedValue(mockPaymentAggregates)
      mockPrisma.booking.groupBy
        .mockResolvedValueOnce(mockBookingStats)
        .mockResolvedValueOnce(mockPendingBalanceAggregates)
    })

    it('returns customers for the authenticated business', async () => {
      const result = await getCustomers()

      expect(mockPrisma.customer.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { businessId } })
      )
      expect(result).toHaveLength(2)
    })

    it('uses businessId from session, not from input', async () => {
      mockRequireBusiness.mockResolvedValue({ businessId: 'session-biz-999' })
      mockPrisma.customer.findMany.mockResolvedValue([])

      await getCustomers()

      expect(mockPrisma.customer.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { businessId: 'session-biz-999' } })
      )
    })

    it('returns empty array when no customers', async () => {
      mockPrisma.customer.findMany.mockResolvedValue([])

      const result = await getCustomers()

      expect(result).toEqual([])
      expect(mockPrisma.payment.groupBy).not.toHaveBeenCalled()
      expect(mockPrisma.booking.groupBy).not.toHaveBeenCalled()
    })

    it('merges payment and booking aggregates correctly', async () => {
      const result = await getCustomers()

      expect(result[0].totalPaidApproved).toBe(30000)
      expect(result[0].bookingCount).toBe(3)
      expect(result[0].pendingBalance).toBe(10000)
      expect(result[0].lastBookingAt).toEqual(new Date('2024-07-15'))

      expect(result[1].totalPaidApproved).toBe(15000)
      expect(result[1].bookingCount).toBe(1)
      expect(result[1].pendingBalance).toBe(0)
    })

    it('uses separate queries for booking count and pending balance', async () => {
      await getCustomers()

      const calls = mockPrisma.booking.groupBy.mock.calls

      // First call: booking stats (count + max) - no sum
      expect(calls[0][0].where).toEqual(
        expect.objectContaining({
          businessId,
          status: expect.objectContaining({
            notIn: expect.arrayContaining([
              BookingStatus.cancelled,
              BookingStatus.no_show,
              BookingStatus.expired,
            ]),
          }),
        })
      )
      expect(calls[0][0]._count).toEqual({ id: true })
      expect(calls[0][0]._max).toEqual({ startDateTime: true })
      expect(calls[0][0]._sum).toBeUndefined()
      expect(calls[0][0].where.remainingBalance).toBeUndefined()

      // Second call: pending balance (sum only) - with remainingBalance > 0
      expect(calls[1][0].where).toEqual(
        expect.objectContaining({
          businessId,
          remainingBalance: { gt: 0 },
          status: expect.objectContaining({
            notIn: expect.arrayContaining([
              BookingStatus.cancelled,
              BookingStatus.no_show,
              BookingStatus.expired,
            ]),
          }),
        })
      )
      expect(calls[1][0]._sum).toEqual({ remainingBalance: true })
      expect(calls[1][0]._count).toBeUndefined()
      expect(calls[1][0]._max).toBeUndefined()
    })

    it('pendingBalance query filters remainingBalance > 0', async () => {
      await getCustomers()

      const pendingCall = mockPrisma.booking.groupBy.mock.calls[1][0]
      expect(pendingCall.where.remainingBalance).toEqual({ gt: 0 })
    })

    it('sorts by lastBookingAt desc, then createdAt desc', async () => {
      mockPrisma.customer.findMany.mockResolvedValue([
        { ...mockCustomers[0], createdAt: new Date('2024-01-01') },
        { ...mockCustomers[1], createdAt: new Date('2024-01-01') },
      ])
      mockPrisma.booking.groupBy.mockReset()
      mockPrisma.booking.groupBy
        .mockResolvedValueOnce([
          {
            customerId: 'cust-1',
            _count: { id: 1 },
            _max: { startDateTime: new Date('2024-05-01') },
          },
          {
            customerId: 'cust-2',
            _count: { id: 1 },
            _max: { startDateTime: new Date('2024-06-01') },
          },
        ])
        .mockResolvedValueOnce(mockPendingBalanceAggregates)

      const result = await getCustomers()

      expect(result[0].id).toBe('cust-2')
      expect(result[1].id).toBe('cust-1')
    })

    it('filters payment aggregates by status approved and not refund', async () => {
      await getCustomers()

      const paymentGroupByCall = mockPrisma.payment.groupBy.mock.calls[0][0]
      expect(paymentGroupByCall.where).toMatchObject({
        businessId,
        status: PaymentStatus.approved,
        paymentType: { not: 'refund' },
      })
    })

    it('booking stats query excludes cancelled, no_show, expired', async () => {
      await getCustomers()

      const bookingStatsCall = mockPrisma.booking.groupBy.mock.calls[0][0]
      expect(bookingStatsCall.where.status.notIn).toEqual(
        expect.arrayContaining([
          BookingStatus.cancelled,
          BookingStatus.no_show,
          BookingStatus.expired,
        ])
      )
    })

    it('does not sum bookings from another business', async () => {
      mockRequireBusiness.mockResolvedValue({ businessId: 'my-biz' })

      await getCustomers()

      const paymentCall = mockPrisma.payment.groupBy.mock.calls[0][0]
      expect(paymentCall.where.businessId).toBe('my-biz')
      expect(paymentCall.where.customerId.in).toEqual(
        expect.arrayContaining(['cust-1', 'cust-2'])
      )

      const statsCall = mockPrisma.booking.groupBy.mock.calls[0][0]
      expect(statsCall.where.businessId).toBe('my-biz')

      const pendingCall = mockPrisma.booking.groupBy.mock.calls[1][0]
      expect(pendingCall.where.businessId).toBe('my-biz')
    })

    it('limits to 500 customers', async () => {
      mockPrisma.customer.findMany.mockResolvedValue([])

      await getCustomers()

      expect(mockPrisma.customer.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 500 })
      )
    })
  })

  describe('getCustomerDetail', () => {
    beforeEach(() => {
      mockPrisma.customer.findFirst.mockResolvedValue(mockCustomers[0])
      mockPrisma.booking.findMany.mockResolvedValue([])
      mockPrisma.payment.findMany.mockResolvedValue([])
      mockPrisma.payment.aggregate.mockResolvedValue({ _sum: { amount: 30000 } })
      mockPrisma.booking.aggregate
        .mockResolvedValueOnce({
          _count: { id: 3 },
          _max: { startDateTime: new Date('2024-07-15') },
        })
        .mockResolvedValueOnce({
          _sum: { remainingBalance: 10000 },
        })
    })

    it('returns customer with bookings, payments and aggregates', async () => {
      const result = await getCustomerDetail('cust-1')

      expect(result.id).toBe('cust-1')
      expect(result.name).toBe('Maria Garcia')
      expect(result.totalPaidApproved).toBe(30000)
      expect(result.pendingBalance).toBe(10000)
      expect(result.bookingCount).toBe(3)
    })

    it('bookingCount does not depend on remainingBalance filter', async () => {
      mockPrisma.booking.aggregate.mockReset()
      mockPrisma.booking.aggregate
        .mockResolvedValueOnce({
          _count: { id: 5 },
          _max: { startDateTime: new Date('2024-07-15') },
        })
        .mockResolvedValueOnce({
          _sum: { remainingBalance: 0 },
        })

      const result = await getCustomerDetail('cust-1')

      expect(result.bookingCount).toBe(5)
    })

    it('rejects customer from another business', async () => {
      mockPrisma.customer.findFirst.mockResolvedValue(null)

      await expect(getCustomerDetail('cust-1')).rejects.toThrow('Clienta no encontrada')
    })

    it('validates ownership with businessId from session', async () => {
      mockRequireBusiness.mockResolvedValue({ businessId: 'other-biz' })
      mockPrisma.customer.findFirst.mockResolvedValue(null)

      await expect(getCustomerDetail('cust-1')).rejects.toThrow('Clienta no encontrada')

      expect(mockPrisma.customer.findFirst).toHaveBeenCalledWith({
        where: { id: 'cust-1', businessId: 'other-biz' },
      })
    })

    it('payment aggregate excludes refunds', async () => {
      await getCustomerDetail('cust-1')

      expect(mockPrisma.payment.aggregate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            customerId: 'cust-1',
            businessId,
            status: PaymentStatus.approved,
            paymentType: { not: 'refund' },
          },
        })
      )
    })

    it('booking stats aggregate excludes cancelled, no_show, expired', async () => {
      await getCustomerDetail('cust-1')

      expect(mockPrisma.booking.aggregate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            customerId: 'cust-1',
            businessId,
            status: {
              notIn: expect.arrayContaining([
                BookingStatus.cancelled,
                BookingStatus.no_show,
                BookingStatus.expired,
              ]),
            },
          },
        })
      )
    })

    it('pendingBalance aggregate includes remainingBalance gt 0', async () => {
      await getCustomerDetail('cust-1')

      const calls = mockPrisma.booking.aggregate.mock.calls
      // Second aggregate call: pendingBalance sum
      expect(calls[1][0].where).toEqual(
        expect.objectContaining({
          customerId: 'cust-1',
          businessId,
          remainingBalance: { gt: 0 },
          status: {
            notIn: expect.arrayContaining([
              BookingStatus.cancelled,
              BookingStatus.no_show,
              BookingStatus.expired,
            ]),
          },
        })
      )
      expect(calls[1][0]._sum).toEqual({ remainingBalance: true })
    })

    it('does not sum bookings from another business in aggregates', async () => {
      mockRequireBusiness.mockResolvedValue({ businessId: 'my-biz' })
      mockPrisma.customer.findFirst.mockResolvedValue(mockCustomers[0])

      await getCustomerDetail('cust-1')

      const statsCall = mockPrisma.booking.aggregate.mock.calls[0][0]
      expect(statsCall.where.businessId).toBe('my-biz')

      const pendingCall = mockPrisma.booking.aggregate.mock.calls[1][0]
      expect(pendingCall.where.businessId).toBe('my-biz')
    })
  })

  describe('updateCustomer', () => {
    const validUpdate = {
      name: 'Maria Actualizada',
      phone: '56911111111',
      email: 'maria.nueva@test.com',
    }

    it('requires owner or admin role', async () => {
      mockRequireBusinessRole.mockRejectedValue(
        new (await import('@/lib/auth/server')).ForbiddenError()
      )

      await expect(updateCustomer('cust-1', validUpdate)).rejects.toThrow('No tienes permisos')
    })

    it('updates customer that belongs to business', async () => {
      mockPrisma.customer.findFirst.mockResolvedValue(mockCustomers[0])
      mockPrisma.customer.update.mockResolvedValue({
        ...mockCustomers[0],
        ...validUpdate,
        updatedAt: new Date(),
      })

      const result = await updateCustomer('cust-1', validUpdate)

      expect(result.name).toBe('Maria Actualizada')
      expect(mockPrisma.customer.update).toHaveBeenCalledWith({
        where: { id: 'cust-1' },
        data: expect.objectContaining({
          name: 'Maria Actualizada',
          phone: '56911111111',
        }),
      })
    })

    it('stores normalized phone', async () => {
      mockPrisma.customer.findFirst.mockResolvedValue(mockCustomers[0])
      mockPrisma.customer.update.mockResolvedValue({
        ...mockCustomers[0],
        updatedAt: new Date(),
      })

      await updateCustomer('cust-1', {
        ...validUpdate,
        phone: '+56 9 1111-1111',
      })

      expect(mockPrisma.customer.update).toHaveBeenCalledWith({
        where: { id: 'cust-1' },
        data: expect.objectContaining({ phone: '56911111111' }),
      })
    })

    it('rejects customer from another business', async () => {
      mockPrisma.customer.findFirst.mockResolvedValue(null)

      await expect(updateCustomer('cust-1', validUpdate)).rejects.toThrow(
        'Clienta no encontrada'
      )
      expect(mockPrisma.customer.update).not.toHaveBeenCalled()
    })

    it('rejects invalid data', async () => {
      mockPrisma.customer.findFirst.mockResolvedValue(mockCustomers[0])

      await expect(updateCustomer('cust-1', { name: '' })).rejects.toThrow('Datos invalidos')
      expect(mockPrisma.customer.update).not.toHaveBeenCalled()
    })

    it('strips extra fields like businessId', async () => {
      mockPrisma.customer.findFirst.mockResolvedValue(mockCustomers[0])
      mockPrisma.customer.update.mockResolvedValue({
        ...mockCustomers[0],
        ...validUpdate,
        updatedAt: new Date(),
      })

      await updateCustomer('cust-1', {
        ...validUpdate,
        businessId: 'malicious-biz',
      })

      expect(mockPrisma.customer.update).toHaveBeenCalledWith({
        where: { id: 'cust-1' },
        data: expect.objectContaining({ name: 'Maria Actualizada' }),
      })

      const updateData = mockPrisma.customer.update.mock.calls[0][0].data
      expect((updateData as Record<string, unknown>).businessId).toBeUndefined()
    })

    it('converts empty email string to null', async () => {
      mockPrisma.customer.findFirst.mockResolvedValue(mockCustomers[0])
      mockPrisma.customer.update.mockResolvedValue({
        ...mockCustomers[0],
        updatedAt: new Date(),
      })

      await updateCustomer('cust-1', { ...validUpdate, email: '' })

      expect(mockPrisma.customer.update).toHaveBeenCalledWith({
        where: { id: 'cust-1' },
        data: expect.objectContaining({ email: null }),
      })
    })

    it('revalidates paths after update', async () => {
      mockPrisma.customer.findFirst.mockResolvedValue(mockCustomers[0])
      mockPrisma.customer.update.mockResolvedValue({
        ...mockCustomers[0],
        ...validUpdate,
        updatedAt: new Date(),
      })

      await updateCustomer('cust-1', validUpdate)

      expect(mockRevalidatePath).toHaveBeenCalledWith('/dashboard/customers')
      expect(mockRevalidatePath).toHaveBeenCalledWith('/dashboard/customers/cust-1')
    })

    it('checks ownership with businessId from session', async () => {
      mockRequireBusinessRole.mockResolvedValue({ businessId: 'real-biz' })
      mockPrisma.customer.findFirst.mockResolvedValue(null)

      await expect(updateCustomer('cust-1', validUpdate)).rejects.toThrow('Clienta no encontrada')

      expect(mockPrisma.customer.findFirst).toHaveBeenCalledWith({
        where: { id: 'cust-1', businessId: 'real-biz' },
      })
    })

    it('rejects when rate limited', async () => {
      mockCheckRateLimit.mockResolvedValue({ success: false })

      await expect(updateCustomer('cust-1', validUpdate)).rejects.toThrow(
        'Demasiadas solicitudes'
      )
      expect(mockPrisma.customer.findFirst).not.toHaveBeenCalled()
      expect(mockPrisma.customer.update).not.toHaveBeenCalled()
    })

    it('handles null email', async () => {
      mockPrisma.customer.findFirst.mockResolvedValue(mockCustomers[0])
      mockPrisma.customer.update.mockResolvedValue({
        ...mockCustomers[0],
        updatedAt: new Date(),
      })

      await updateCustomer('cust-1', { ...validUpdate, email: null })

      const updateData = mockPrisma.customer.update.mock.calls[0][0].data
      expect((updateData as Record<string, unknown>).email).toBeNull()
    })
  })

  describe('updateCustomerNotes', () => {
    it('requires owner or admin role', async () => {
      mockRequireBusinessRole.mockRejectedValue(
        new (await import('@/lib/auth/server')).ForbiddenError()
      )

      await expect(updateCustomerNotes('cust-1', { notes: 'Test' })).rejects.toThrow(
        'No tienes permisos'
      )
    })

    it('updates notes for customer that belongs to business', async () => {
      mockPrisma.customer.findFirst.mockResolvedValue(mockCustomers[0])
      mockPrisma.customer.update.mockResolvedValue({
        ...mockCustomers[0],
        notes: 'Nuevas notas',
        updatedAt: new Date(),
      })

      const result = await updateCustomerNotes('cust-1', { notes: 'Nuevas notas' })

      expect(result.notes).toBe('Nuevas notas')
      expect(mockPrisma.customer.update).toHaveBeenCalledWith({
        where: { id: 'cust-1' },
        data: { notes: 'Nuevas notas' },
      })
    })

    it('rejects customer from another business', async () => {
      mockPrisma.customer.findFirst.mockResolvedValue(null)

      await expect(updateCustomerNotes('cust-1', { notes: 'Test' })).rejects.toThrow(
        'Clienta no encontrada'
      )
      expect(mockPrisma.customer.update).not.toHaveBeenCalled()
    })

    it('rejects notes > 2000 chars', async () => {
      mockPrisma.customer.findFirst.mockResolvedValue(mockCustomers[0])

      await expect(
        updateCustomerNotes('cust-1', { notes: 'a'.repeat(2001) })
      ).rejects.toThrow('Datos invalidos')
      expect(mockPrisma.customer.update).not.toHaveBeenCalled()
    })

    it('converts empty string notes to null', async () => {
      mockPrisma.customer.findFirst.mockResolvedValue(mockCustomers[0])
      mockPrisma.customer.update.mockResolvedValue({
        ...mockCustomers[0],
        notes: null,
        updatedAt: new Date(),
      })

      await updateCustomerNotes('cust-1', { notes: '' })

      expect(mockPrisma.customer.update).toHaveBeenCalledWith({
        where: { id: 'cust-1' },
        data: { notes: null },
      })
    })

    it('revalidates paths after update', async () => {
      mockPrisma.customer.findFirst.mockResolvedValue(mockCustomers[0])
      mockPrisma.customer.update.mockResolvedValue({
        ...mockCustomers[0],
        notes: 'Test',
        updatedAt: new Date(),
      })

      await updateCustomerNotes('cust-1', { notes: 'Test' })

      expect(mockRevalidatePath).toHaveBeenCalledWith('/dashboard/customers')
      expect(mockRevalidatePath).toHaveBeenCalledWith('/dashboard/customers/cust-1')
    })

    it('strips extra fields', async () => {
      mockPrisma.customer.findFirst.mockResolvedValue(mockCustomers[0])
      mockPrisma.customer.update.mockResolvedValue({
        ...mockCustomers[0],
        notes: 'Test',
        updatedAt: new Date(),
      })

      await updateCustomerNotes('cust-1', {
        notes: 'Test',
        customerId: 'malicious',
        extraField: 'nope',
      })

      const updateData = mockPrisma.customer.update.mock.calls[0][0].data
      expect((updateData as Record<string, unknown>).customerId).toBeUndefined()
      expect((updateData as Record<string, unknown>).extraField).toBeUndefined()
    })

    it('rejects when rate limited', async () => {
      mockCheckRateLimit.mockResolvedValue({ success: false })

      await expect(updateCustomerNotes('cust-1', { notes: 'Test' })).rejects.toThrow(
        'Demasiadas solicitudes'
      )
      expect(mockPrisma.customer.findFirst).not.toHaveBeenCalled()
    })
  })
})
