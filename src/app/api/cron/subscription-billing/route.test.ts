import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { runSubscriptionBillingCron } = vi.hoisted(() => ({
  runSubscriptionBillingCron: vi.fn(),
}))

vi.mock('@/lib/cron/subscription-billing', () => ({ runSubscriptionBillingCron }))
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), info: vi.fn() },
}))

import { GET, POST } from './route'

const result = {
  processed: 8,
  reconciled: 3,
  notified: 2,
  suspended: 1,
  errors: 0,
}

function request(method = 'POST', secret?: string) {
  return new Request('https://agendita.test/api/cron/subscription-billing', {
    method,
    headers: secret ? { authorization: `Bearer ${secret}` } : undefined,
  })
}

describe('/api/cron/subscription-billing', () => {
  beforeEach(() => {
    process.env.CRON_SECRET = 'cron-secret'
    runSubscriptionBillingCron.mockReset().mockResolvedValue(result)
  })

  afterEach(() => {
    delete process.env.CRON_SECRET
  })

  it.each([undefined, 'wrong'])('falla cerrado cuando el bearer no es válido', async (secret) => {
    const response = await POST(request('POST', secret))

    expect(response.status).toBe(401)
    expect(runSubscriptionBillingCron).not.toHaveBeenCalled()
  })

  it.each([
    ['POST', POST],
    ['GET', GET],
  ])('%s devuelve sólo conteos agregados', async (method, handler) => {
    const response = await handler(request(method, 'cron-secret'))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual(result)
    expect(Object.keys(body)).toEqual(['processed', 'reconciled', 'notified', 'suspended', 'errors'])
    expect(JSON.stringify(body)).not.toMatch(/subscription-|business-|provider-/)
    expect(runSubscriptionBillingCron).toHaveBeenCalledWith({ now: expect.any(Date) })
  })

  it('convierte un fallo global en un resultado sanitario sin propagar IDs ni mensajes', async () => {
    runSubscriptionBillingCron.mockRejectedValueOnce(new Error('provider-subscription-secret-id'))

    const response = await POST(request('POST', 'cron-secret'))

    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({
      processed: 0,
      reconciled: 0,
      notified: 0,
      suspended: 0,
      errors: 1,
    })
  })

  it('devuelve 500 con los conteos sanitarios cuando algún negocio falla internamente', async () => {
    runSubscriptionBillingCron.mockResolvedValueOnce({ ...result, errors: 2 })

    const response = await POST(request('POST', 'cron-secret'))

    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ ...result, errors: 2 })
  })
})
