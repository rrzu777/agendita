import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  isDependencyReady,
  probeMercadoPago,
  probeRedis,
  probeResend,
  probeSupabase,
} from '@/lib/health/dependencies'

describe('dependency health probes', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  describe('probeRedis', () => {
    it('returns not_configured when both REST credentials are absent', async () => {
      vi.stubEnv('UPSTASH_REDIS_REST_URL', '')
      vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', '')

      await expect(probeRedis()).resolves.toBe('not_configured')
    })

    it('marks partial configuration down without fetching', async () => {
      vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://redis.example.com')
      vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', '')
      const fetchMock = vi.spyOn(global, 'fetch')
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)

      await expect(probeRedis()).resolves.toBe('down')
      expect(fetchMock).not.toHaveBeenCalled()
      expect(errorSpy).toHaveBeenCalledWith('[Health] Redis check failed', {
        reason: 'partial_configuration',
      })
    })

    it('marks Redis up only when no-write EVAL returns 1', async () => {
      vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://redis.example.com')
      vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'redis-token')
      const controller = new AbortController()
      const timeoutSpy = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal)
      const fetchMock = vi.spyOn(global, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ result: 1 }), { status: 200 }),
      )

      await expect(probeRedis()).resolves.toBe('up')

      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
      expect(url).toBe('https://redis.example.com')
      expect(JSON.parse(init.body as string)).toEqual([
        'EVAL',
        'return 1',
        0,
      ])
      expect(timeoutSpy).toHaveBeenCalledWith(3_000)
      expect(init.signal).toBe(controller.signal)
    })

    it.each(['NOPE', null])('marks unexpected result %s down', async result => {
      vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://redis.example.com')
      vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'redis-token')
      vi.spyOn(global, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ result }), { status: 200 }),
      )
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)

      await expect(probeRedis()).resolves.toBe('down')
      expect(errorSpy).toHaveBeenCalledWith('[Health] Redis check failed', {
        reason: 'invalid_response',
      })
    })

    it('marks an HTTP rejection down', async () => {
      vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://redis.example.com')
      vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'redis-token')
      vi.spyOn(global, 'fetch').mockResolvedValue(
        new Response('private-provider-detail', { status: 401 }),
      )
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)

      await expect(probeRedis()).resolves.toBe('down')
      expect(errorSpy).toHaveBeenCalledWith('[Health] Redis check failed', {
        reason: 'http_status',
        status: 401,
      })
      expect(JSON.stringify(errorSpy.mock.calls)).not.toContain('redis-token')
      expect(JSON.stringify(errorSpy.mock.calls)).not.toContain('redis.example.com')
      expect(JSON.stringify(errorSpy.mock.calls)).not.toContain('private-provider-detail')
    })

    it('logs a sanitized category when the request rejects', async () => {
      vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://redis.example.com')
      vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'redis-token')
      vi.spyOn(global, 'fetch').mockRejectedValue(
        new DOMException('private-network-detail', 'AbortError'),
      )
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)

      await expect(probeRedis()).resolves.toBe('down')
      expect(errorSpy).toHaveBeenCalledWith('[Health] Redis check failed', {
        reason: 'timeout_or_network',
      })
      expect(JSON.stringify(errorSpy.mock.calls)).not.toContain('private-network-detail')
    })
  })

  describe('probeSupabase', () => {
    it('returns not_configured when URL or key is absent', async () => {
      vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://supabase.example.com')
      vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '')
      vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', '')

      await expect(probeSupabase()).resolves.toBe('not_configured')
    })

    it('uses the service key and reports an HTTP success', async () => {
      vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://supabase.example.com/')
      vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-key')
      const fetchMock = vi.spyOn(global, 'fetch').mockResolvedValue(
        new Response('{}', { status: 200 }),
      )

      await expect(probeSupabase()).resolves.toBe('up')
      expect(fetchMock).toHaveBeenCalledWith(
        'https://supabase.example.com/rest/v1/?limit=1',
        expect.objectContaining({
          headers: {
            Authorization: 'Bearer service-key',
            apikey: 'service-key',
          },
          cache: 'no-store',
        }),
      )
    })

    it('marks a network rejection down', async () => {
      vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://supabase.example.com')
      vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-key')
      vi.spyOn(global, 'fetch').mockRejectedValue(new Error('network detail'))

      await expect(probeSupabase()).resolves.toBe('down')
    })
  })

  describe('probeResend', () => {
    it('returns not_configured without an API key', async () => {
      vi.stubEnv('RESEND_API_KEY', '')

      await expect(probeResend()).resolves.toBe('not_configured')
    })

    it('authenticates a sending-only key without sending an email', async () => {
      vi.stubEnv('RESEND_API_KEY', 'resend-token')
      const fetchMock = vi.spyOn(global, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ name: 'missing_required_field' }), { status: 422 }),
      )

      await expect(probeResend()).resolves.toBe('up')
      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.resend.com/emails',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer resend-token',
            'Content-Type': 'application/json',
            'User-Agent': 'agendita-health/1.0',
          }),
          body: '{}',
          cache: 'no-store',
        }),
      )
    })

    it.each([
      new Response('private-provider-detail', { status: 403 }),
      new Response(JSON.stringify({ name: 'validation_error' }), { status: 422 }),
    ])('marks an invalid provider response down', async response => {
      vi.stubEnv('RESEND_API_KEY', 'resend-token')
      vi.spyOn(global, 'fetch').mockResolvedValue(response)

      await expect(probeResend()).resolves.toBe('down')
    })

    it('marks a timeout down instead of throwing', async () => {
      vi.stubEnv('RESEND_API_KEY', 'resend-token')
      vi.spyOn(global, 'fetch').mockRejectedValue(new DOMException('Timed out', 'AbortError'))

      await expect(probeResend()).resolves.toBe('down')
    })
  })

  describe('probeMercadoPago', () => {
    it('returns not_required unless Mercado Pago is the selected provider', async () => {
      vi.stubEnv('PAYMENT_PROVIDER', 'manual')

      await expect(probeMercadoPago()).resolves.toBe('not_required')
    })

    it('returns not_configured when the global token is absent', async () => {
      vi.stubEnv('PAYMENT_PROVIDER', 'mercado_pago')
      vi.stubEnv('MERCADO_PAGO_ACCESS_TOKEN', '')

      await expect(probeMercadoPago()).resolves.toBe('not_configured')
    })

    it('requires the global token in OAuth-only Mercado Pago mode', async () => {
      vi.stubEnv('PAYMENT_PROVIDER', '')
      vi.stubEnv('MERCADO_PAGO_CLIENT_ID', 'client-id')
      vi.stubEnv('MERCADO_PAGO_CLIENT_SECRET', 'client-secret')
      vi.stubEnv('MERCADO_PAGO_REDIRECT_URI', 'https://app.example.com/callback')
      vi.stubEnv('MERCADO_PAGO_ACCESS_TOKEN', '')

      await expect(probeMercadoPago()).resolves.toBe('not_configured')
    })

    it('keeps manual payments not_required even when OAuth credentials exist', async () => {
      vi.stubEnv('PAYMENT_PROVIDER', 'manual')
      vi.stubEnv('MERCADO_PAGO_CLIENT_ID', 'client-id')
      vi.stubEnv('MERCADO_PAGO_CLIENT_SECRET', 'client-secret')
      vi.stubEnv('MERCADO_PAGO_REDIRECT_URI', 'https://app.example.com/callback')

      await expect(probeMercadoPago()).resolves.toBe('not_required')
    })

    it('requires a successful identity payload', async () => {
      vi.stubEnv('PAYMENT_PROVIDER', 'mercado_pago')
      vi.stubEnv('MERCADO_PAGO_ACCESS_TOKEN', 'mp-token')
      const fetchMock = vi.spyOn(global, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ id: 123 }), { status: 200 }),
      )

      await expect(probeMercadoPago()).resolves.toBe('up')
      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.mercadopago.com/users/me',
        expect.objectContaining({
          headers: { Authorization: 'Bearer mp-token' },
          cache: 'no-store',
        }),
      )
    })

    it.each([
      new Response('private-provider-detail', { status: 403 }),
      new Response(JSON.stringify({ site_id: 'MLC' }), { status: 200 }),
    ])('marks an invalid credential response down', async response => {
      vi.stubEnv('PAYMENT_PROVIDER', 'mercado_pago')
      vi.stubEnv('MERCADO_PAGO_ACCESS_TOKEN', 'mp-token')
      vi.spyOn(global, 'fetch').mockResolvedValue(response)

      await expect(probeMercadoPago()).resolves.toBe('down')
    })
  })

  describe('isDependencyReady', () => {
    it('requires up for a required dependency', () => {
      expect(isDependencyReady('up', true)).toBe(true)
      expect(isDependencyReady('not_configured', true)).toBe(false)
      expect(isDependencyReady('not_required', true)).toBe(false)
      expect(isDependencyReady('down', true)).toBe(false)
    })

    it('accepts non-required missing or inapplicable dependencies but never down', () => {
      expect(isDependencyReady('up', false)).toBe(true)
      expect(isDependencyReady('not_configured', false)).toBe(true)
      expect(isDependencyReady('not_required', false)).toBe(true)
      expect(isDependencyReady('down', false)).toBe(false)
    })
  })
})
