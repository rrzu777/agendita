import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { unstable_doesMiddlewareMatch as doesProxyMatch } from 'next/experimental/testing/server'
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { config, proxy } from '@/proxy'

describe('Next proxy file convention', () => {
  beforeEach(() => vi.stubEnv('APP_DOMAIN', 'agendita.cl'))
  afterEach(() => vi.unstubAllEnvs())

  it('uses proxy.ts instead of the deprecated middleware.ts convention', () => {
    const sourceRoot = resolve(import.meta.dirname, '../../src')

    expect(existsSync(resolve(sourceRoot, 'proxy.ts'))).toBe(true)
    expect(existsSync(resolve(sourceRoot, 'middleware.ts'))).toBe(false)
  })

  it.each([
    ['/', true],
    ['/dashboard', true],
    ['/auth/callback?code=abc', true],
    ['/api/health', true],
    ['/_next/static/chunk.js', false],
    ['/_next/image?url=%2Flogo.png', false],
    ['/favicon.ico', false],
    ['/logo.png', false],
  ])('keeps matcher coverage for %s', (url, expected) => {
    expect(doesProxyMatch({ config, nextConfig: {}, url })).toBe(expected)
  })

  it('forwards a stray root OAuth code to the callback and preserves next', async () => {
    const response = await proxy(
      new NextRequest('https://agendita.cl/?code=oauth-code&next=%2Fmi%2Fmimosnails')
    )

    expect(response.headers.get('location')).toBe(
      'https://agendita.cl/auth/callback?code=oauth-code&next=%2Fmi%2Fmimosnails'
    )
  })

  it('injects only the canonical tenant subdomain into downstream headers', async () => {
    const response = await proxy(
      new NextRequest('https://mimosnails.agendita.cl/book', {
        headers: { host: 'mimosnails.agendita.cl', 'x-business-subdomain': 'spoofed' },
      })
    )

    expect(response.headers.get('x-middleware-request-x-business-subdomain')).toBe('mimosnails')
  })

  it('removes a spoofed tenant header on the canonical host', async () => {
    const response = await proxy(
      new NextRequest('https://agendita.cl/dashboard', {
        headers: { host: 'agendita.cl', 'x-business-subdomain': 'spoofed' },
      })
    )

    expect(response.headers.get('x-middleware-request-x-business-subdomain')).toBeNull()
  })
})
