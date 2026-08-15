import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { AuthError, ForbiddenError } from '../helpers/auth-errors'

const mockRequireBusinessRole = vi.fn()
const mockPaymentFindUnique = vi.fn()

vi.mock('@/lib/auth/server', () => ({
  requireBusinessRole: mockRequireBusinessRole,
  AuthError,
  ForbiddenError,
}))

vi.mock('@/lib/db', () => ({
  prisma: { payment: { findUnique: mockPaymentFindUnique } },
}))

vi.mock('@/lib/storage/r2', () => ({
  getObjectStorage: vi.fn(),
}))

describe('GET /dashboard/transfers/proof/[paymentId] auth responses', () => {
  let GET: (
    request: NextRequest,
    context: { params: Promise<{ paymentId: string }> },
  ) => Promise<Response>

  beforeAll(async () => {
    ;({ GET } = await import('@/app/dashboard/transfers/proof/[paymentId]/route'))
  })

  beforeEach(() => {
    vi.clearAllMocks()
  })

  function callGet() {
    return GET(new NextRequest('http://localhost/dashboard/transfers/proof/payment-1'), {
      params: Promise.resolve({ paymentId: 'payment-1' }),
    })
  }

  it('returns 401 instead of leaking an uncaught auth error without a session', async () => {
    mockRequireBusinessRole.mockRejectedValue(new AuthError())

    const response = await callGet()

    expect(response.status).toBe(401)
    expect(mockPaymentFindUnique).not.toHaveBeenCalled()
  })

  it('returns 403 when the authenticated user lacks an allowed business role', async () => {
    mockRequireBusinessRole.mockRejectedValue(new ForbiddenError())

    const response = await callGet()

    expect(response.status).toBe(403)
    expect(mockPaymentFindUnique).not.toHaveBeenCalled()
  })
})
