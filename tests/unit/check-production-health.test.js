import { describe, expect, it, vi } from 'vitest'
import monitor from '../../scripts/check-production-health.cjs'

const { checkProductionHealth } = monitor

function healthResponse(status, httpStatus = 200) {
  return new Response(JSON.stringify({ status }), {
    status: httpStatus,
    headers: { 'content-type': 'application/json' },
  })
}

describe('production health monitor', () => {
  it('checks both public and protected health before succeeding', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(healthResponse('ok'))
      .mockResolvedValueOnce(healthResponse('ok'))

    const result = await checkProductionHealth({
      baseUrl: 'https://www.agendita.cl/',
      cronSecret: 'secret',
      fetchImpl,
      sleep: vi.fn(),
    })

    expect(result.ok).toBe(true)
    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      'https://www.agendita.cl/api/health',
      expect.not.objectContaining({ headers: expect.anything() }),
    )
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      'https://www.agendita.cl/api/health/dependencies',
      expect.objectContaining({
        headers: { Authorization: 'Bearer secret' },
      }),
    )
  })

  it('retries the pair and fails when public health remains degraded', async () => {
    const fetchImpl = vi.fn(async (url) =>
      String(url).endsWith('/dependencies')
        ? healthResponse('ok')
        : healthResponse('degraded', 503),
    )
    const sleep = vi.fn()

    const result = await checkProductionHealth({
      baseUrl: 'https://www.agendita.cl',
      cronSecret: 'secret',
      fetchImpl,
      sleep,
    })

    expect(result.ok).toBe(false)
    expect(fetchImpl).toHaveBeenCalledTimes(6)
    expect(sleep).toHaveBeenCalledTimes(2)
  })
})
