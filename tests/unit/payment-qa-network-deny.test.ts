import http from 'node:http'
import https from 'node:https'
import { describe, expect, it } from 'vitest'
import { installPaymentQaNetworkDeny } from '../helpers/payment-qa-network-deny'

describe('payment QA offline network boundary', () => {
  it('installs a deny function into controlled targets', () => {
    const targets: {
      global: { fetch?: () => void }
      http: { request?: () => void; get?: () => void }
      https: { request?: () => void; get?: () => void }
    } = { global: {}, http: {}, https: {} }
    installPaymentQaNetworkDeny({ NODE_ENV: 'test', PAYMENT_QA_OFFLINE: '1' }, targets)
    for (const fn of [targets.global.fetch, targets.http.request, targets.http.get, targets.https.request, targets.https.get]) {
      expect(fn).toBeTypeOf('function')
      if (!fn) throw new Error('network deny function was not installed')
      expect(() => fn()).toThrow('blocks external HTTP(S)')
    }
  })

  it.runIf(process.env.PAYMENT_QA_OFFLINE === '1')('is preloaded by the dedicated runner', () => {
    expect(process.env.MERCADO_PAGO_ACCESS_TOKEN).toBeUndefined()
    expect(process.env.RESEND_API_KEY).toBeUndefined()
    expect(() => fetch('https://example.com')).toThrow('blocks external HTTP(S)')
    expect(() => http.get('http://example.com')).toThrow('blocks external HTTP(S)')
    expect(() => https.get('https://example.com')).toThrow('blocks external HTTP(S)')
  })
})
