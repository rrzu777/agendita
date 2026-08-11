import http from 'node:http'
import https from 'node:https'
import { describe, expect, it } from 'vitest'

describe('payment QA offline network boundary', () => {
  it('removes credential sentinels and blocks fetch/http/https', () => {
    expect(process.env.PAYMENT_QA_OFFLINE).toBe('1')
    expect(process.env.MERCADO_PAGO_ACCESS_TOKEN).toBeUndefined()
    expect(process.env.RESEND_API_KEY).toBeUndefined()
    expect(() => fetch('https://example.com')).toThrow('blocks external HTTP(S)')
    expect(() => http.get('http://example.com')).toThrow('blocks external HTTP(S)')
    expect(() => https.get('https://example.com')).toThrow('blocks external HTTP(S)')
  })
})
