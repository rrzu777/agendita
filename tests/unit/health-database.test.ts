import { afterEach, describe, expect, it, vi } from 'vitest'

const { queryRawMock, transactionMock } = vi.hoisted(() => ({
  queryRawMock: vi.fn(),
  transactionMock: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  prisma: {
    $transaction: transactionMock,
  },
}))

import { probeDatabase } from '@/lib/health/database'

describe('probeDatabase', () => {
  afterEach(() => {
    queryRawMock.mockReset()
    transactionMock.mockReset()
  })

  it('uses a cancelable Prisma transaction timeout instead of leaving the query running', async () => {
    transactionMock.mockImplementation(async (callback, options) => {
      expect(options).toEqual({ maxWait: 1_000, timeout: 2_000 })
      return callback({ $queryRaw: queryRawMock })
    })
    queryRawMock.mockResolvedValue([{ value: 1 }])

    await expect(probeDatabase()).resolves.toBe('up')
    expect(transactionMock).toHaveBeenCalledOnce()
    expect(queryRawMock).toHaveBeenCalledOnce()
  })

  it('returns down when Prisma cancels the timed transaction', async () => {
    transactionMock.mockRejectedValue(new Error('Transaction already closed'))

    await expect(probeDatabase()).resolves.toBe('down')
  })
})
