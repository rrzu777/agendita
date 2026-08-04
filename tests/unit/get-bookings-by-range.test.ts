import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getBookingsByRange } from '@/server/actions/bookings'
import { anyDeclaredTransferWhere } from '@/lib/bank-transfer/declared'

const mockRequireBusiness = vi.fn().mockResolvedValue({ businessId: 'biz-1' })
const mockFindMany = vi.fn().mockResolvedValue([])

vi.mock('@/lib/auth/server', () => ({
  requireBusiness: (...args: unknown[]) => mockRequireBusiness(...args),
}))

vi.mock('@/lib/db', () => ({
  prisma: {
    booking: {
      findMany: (...args: unknown[]) => mockFindMany(...args),
    },
  },
}))

describe('getBookingsByRange', () => {
  beforeEach(() => {
    mockFindMany.mockClear()
  })

  it('returns bookings filtered by business and date range', async () => {
    mockFindMany.mockResolvedValueOnce([
      { id: 'b1', status: 'confirmed', startDateTime: new Date('2026-05-18T10:00:00Z') },
    ])
    const start = new Date('2026-05-01')
    const end = new Date('2026-05-31')

    const result = await getBookingsByRange(start, end)

    expect(mockRequireBusiness).toHaveBeenCalledTimes(1)
    expect(result.length).toBe(1)
    expect(result[0].id).toBe('b1')
    expect(mockFindMany).toHaveBeenCalledWith({
      where: {
        businessId: 'biz-1',
        startDateTime: { gte: start, lte: end },
      },
      orderBy: { startDateTime: 'asc' },
      include: {
        service: true,
        customer: true,
        professional: { select: { name: true } },
        // El chip del calendario necesita saber si hay una transferencia
        // declarada sin verificar antes de darle el plazo por vencido.
        payments: {
          where: anyDeclaredTransferWhere,
          select: { providerPaymentId: true },
        },
      },
    })
  })

  it('returns empty array when no bookings match', async () => {
    const result = await getBookingsByRange(
      new Date('2026-05-01'),
      new Date('2026-05-31')
    )
    expect(result).toEqual([])
  })

  it('throws for invalid date range (start > end)', async () => {
    await expect(
      getBookingsByRange(new Date('2026-05-31'), new Date('2026-05-01'))
    ).rejects.toThrow('La fecha de inicio debe ser anterior a la fecha de término')
  })

  it('throws for invalid Date objects', async () => {
    await expect(
      getBookingsByRange(new Date('invalid'), new Date('2026-05-31'))
    ).rejects.toThrow('Rango de fechas inválido')
  })
})
