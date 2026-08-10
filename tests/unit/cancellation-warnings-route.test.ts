import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const { mockSendCancellationWarnings, mockLogger } = vi.hoisted(() => ({
  mockSendCancellationWarnings: vi.fn(),
  mockLogger: { info: vi.fn() },
}))

vi.mock('@/lib/cron/send-cancellation-warnings', () => ({
  sendCancellationWarnings: mockSendCancellationWarnings,
}))
vi.mock('@/lib/logger', () => ({ logger: mockLogger }))

const { GET, POST } = await import('@/app/api/cron/cancellation-warnings/route')

function request(method: 'GET' | 'POST', token?: string) {
  return new NextRequest('https://www.agendita.cl/api/cron/cancellation-warnings', {
    method,
    headers: token ? { authorization: `Bearer ${token}` } : undefined,
  })
}

describe('/api/cron/cancellation-warnings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.CRON_SECRET = 'cron-test-secret'
    mockSendCancellationWarnings.mockResolvedValue({ sent: 2, skipped: 3, errors: 0 })
  })

  it.each([
    ['GET', GET],
    ['POST', POST],
  ] as const)('%s rechaza antes de ejecutar el cron si falta auth', async (method, handler) => {
    const response = await handler(request(method))

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: 'Unauthorized' })
    expect(mockSendCancellationWarnings).not.toHaveBeenCalled()
  })

  it.each([
    ['GET', GET],
    ['POST', POST],
  ] as const)('%s ejecuta y devuelve sólo los contadores con bearer válido', async (method, handler) => {
    const response = await handler(request(method, 'cron-test-secret'))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ sent: 2, skipped: 3, errors: 0 })
    expect(mockSendCancellationWarnings).toHaveBeenCalledTimes(1)
    expect(mockLogger.info).toHaveBeenCalledWith(
      'booking.cancellation_warning_cron',
      'Cancellation warning cron completed',
      { metadata: { sent: 2, skipped: 3, errors: 0 } },
    )
  })
})
