import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  createMercadoPagoOAuthState,
  exchangeAuthorizationCode,
  verifyMercadoPagoOAuthState,
} from './mercado-pago-oauth'

describe('Mercado Pago business OAuth', () => {
  beforeEach(() => {
    process.env.ENCRYPTION_KEY = 'test-encryption-key'
  })

  it('adds test_token exactly in sandbox exchanges', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      access_token: 'access', refresh_token: 'refresh', expires_in: 3600, user_id: 12,
    }), { status: 200, headers: { 'content-type': 'application/json' } }))

    await exchangeAuthorizationCode({
      environment: 'sandbox', clientId: 'client', clientSecret: 'secret',
      redirectUri: 'https://example.com/callback', code: 'code', codeVerifier: 'verifier',
    }, { fetch })

    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({
      client_id: 'client', client_secret: 'secret', code: 'code',
      grant_type: 'authorization_code', redirect_uri: 'https://example.com/callback',
      code_verifier: 'verifier', test_token: true,
    })
  })

  it('never adds test_token in production exchanges', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      access_token: 'access', refresh_token: 'refresh', expires_in: 3600, user_id: 12,
    }), { status: 200, headers: { 'content-type': 'application/json' } }))

    await exchangeAuthorizationCode({
      environment: 'production', clientId: 'client', clientSecret: 'secret',
      redirectUri: 'https://example.com/callback', code: 'code', codeVerifier: 'verifier',
    }, { fetch })

    expect(JSON.parse(fetch.mock.calls[0][1].body)).not.toHaveProperty('test_token')
  })

  it('binds signed state to the selected environment and expiry', () => {
    const expiresAt = new Date('2026-08-11T12:10:00.000Z')
    const state = createMercadoPagoOAuthState({
      businessId: 'business-1', environment: 'sandbox', nonce: 'nonce', expiresAt,
    })

    expect(verifyMercadoPagoOAuthState(state, 'sandbox', new Date('2026-08-11T12:00:00.000Z')))
      .toEqual({ businessId: 'business-1', environment: 'sandbox', nonce: 'nonce', expiresAt })
    expect(verifyMercadoPagoOAuthState(state, 'production', new Date('2026-08-11T12:00:00.000Z')))
      .toBeNull()
    expect(verifyMercadoPagoOAuthState(state, 'sandbox', new Date('2026-08-11T12:11:00.000Z')))
      .toBeNull()
  })

  it('sanitizes failed exchange errors without response body or secrets', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ error: 'bad', echoed_secret: 'do-not-leak' }),
      { status: 401, headers: { 'content-type': 'application/json' } },
    ))

    await expect(exchangeAuthorizationCode({
      environment: 'production', clientId: 'client', clientSecret: 'super-secret',
      redirectUri: 'https://example.com/callback', code: 'code', codeVerifier: 'verifier',
    }, { fetch })).rejects.toThrow('Mercado Pago OAuth token exchange failed (401).')
  })

  it.each([
    ['missing', { access_token: 'access', refresh_token: 'refresh', expires_in: 3600 }],
    ['empty', { access_token: 'access', refresh_token: 'refresh', expires_in: 3600, user_id: '' }],
    ['non numeric', { access_token: 'access', refresh_token: 'refresh', expires_in: 3600, user_id: 'seller' }],
    ['zero', { access_token: 'access', refresh_token: 'refresh', expires_in: 3600, user_id: 0 }],
  ])('rejects an initial token response with %s user_id', async (_name, response) => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(response), {
      status: 200, headers: { 'content-type': 'application/json' },
    }))
    await expect(exchangeAuthorizationCode({
      environment: 'sandbox', clientId: 'client', clientSecret: 'secret',
      redirectUri: 'https://example.com/callback', code: 'code', codeVerifier: 'verifier',
    }, { fetch })).rejects.toThrow('Mercado Pago OAuth returned an invalid token response.')
  })

  it('declares persisted one-time OAuth attempts and refresh leases in the schema', () => {
    const schema = readFileSync('prisma/schema.prisma', 'utf8')
    expect(schema).toContain('model MercadoPagoOAuthAttempt')
    expect(schema).toMatch(/nonceHash\s+String\s+@unique/)
    expect(schema).toMatch(/verifierEncrypted\s+String/)
    expect(schema).toMatch(/consumedAt\s+DateTime\?/)
    expect(schema).toMatch(/refreshLeaseToken\s+String\?/)
    expect(schema).toMatch(/refreshLeaseExpiresAt\s+DateTime\?/)
    expect(schema).toMatch(/tokenVersion\s+Int\s+@default\(0\)/)
  })
})
