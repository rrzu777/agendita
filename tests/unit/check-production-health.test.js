import { describe, expect, it, vi } from 'vitest'
import monitor from '../../scripts/check-production-health.cjs'

const { checkProductionHealth } = monitor

function healthResponse(status, httpStatus = 200) {
  return new Response(JSON.stringify({ status }), {
    status: httpStatus,
    headers: { 'content-type': 'application/json' },
  })
}

function installPageResponse(body = '<h1>Instala Agendita</h1>') {
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  })
}

function installRedirectResponse(location = 'https://www.agendita.cl/instalar') {
  return new Response(null, { status: 307, headers: { location } })
}

describe('production health monitor', () => {
  it('checks both public and protected health before succeeding', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(healthResponse('ok'))
      .mockResolvedValueOnce(healthResponse('ok'))
      .mockResolvedValueOnce(installPageResponse())
      .mockResolvedValueOnce(installRedirectResponse())

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
    expect(fetchImpl).toHaveBeenNthCalledWith(
      3,
      'https://www.agendita.cl/instalar',
      expect.objectContaining({ redirect: 'manual' }),
    )
    expect(fetchImpl).toHaveBeenNthCalledWith(
      4,
      'https://install-smoke.agendita.cl/instalar',
      expect.objectContaining({ redirect: 'manual' }),
    )
    expect(result.installPage).toEqual({ ok: true, httpStatus: 200 })
    expect(result.tenantRedirect).toEqual({ ok: true, httpStatus: 307 })
  })

  it('retries the pair and fails when public health remains degraded', async () => {
    const fetchImpl = vi.fn(async (url) => {
      const target = String(url)
      if (target.endsWith('/dependencies')) return healthResponse('ok')
      if (target.includes('install-smoke.')) return installRedirectResponse()
      if (target.endsWith('/instalar')) return installPageResponse()
      return healthResponse('degraded', 503)
    })
    const sleep = vi.fn()

    const result = await checkProductionHealth({
      baseUrl: 'https://www.agendita.cl',
      cronSecret: 'secret',
      fetchImpl,
      sleep,
    })

    expect(result.ok).toBe(false)
    expect(fetchImpl).toHaveBeenCalledTimes(12)
    expect(sleep).toHaveBeenCalledTimes(2)
  })

  it.each([
    ['canonical installer content', installPageResponse('<h1>Unexpected page</h1>'), installRedirectResponse()],
    ['tenant redirect target', installPageResponse(), installRedirectResponse('https://evil.example/instalar')],
  ])('fails closed when %s is invalid', async (_label, installPage, tenantRedirect) => {
    const fetchImpl = vi.fn(async (url) => {
      const target = String(url)
      if (target.endsWith('/api/health')) return healthResponse('ok')
      if (target.endsWith('/dependencies')) return healthResponse('ok')
      if (target.includes('install-smoke.')) return tenantRedirect
      return installPage
    })

    const result = await checkProductionHealth({
      baseUrl: 'https://www.agendita.cl',
      cronSecret: 'secret',
      fetchImpl,
      sleep: vi.fn(),
      attempts: 1,
    })

    expect(result.ok).toBe(false)
  })
})
