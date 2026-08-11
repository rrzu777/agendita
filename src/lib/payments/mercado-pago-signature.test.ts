import { createHmac } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { verifyMercadoPagoSignature } from './mercado-pago-signature'

const SECRET = 'signature-regression-secret'
const RESOURCE_ID = 'authorized-payment-123'
const REQUEST_ID = 'request-456'
const NOW = new Date('2026-08-11T12:00:00.000Z')

function signature(input: {
  resourceId?: string
  requestId?: string | null
  timestamp?: string
  digest?: string
} = {}): string {
  const resourceId = input.resourceId ?? RESOURCE_ID
  const requestId = input.requestId === undefined ? REQUEST_ID : input.requestId
  const timestamp = input.timestamp ?? String(Math.floor(NOW.getTime() / 1_000))
  const manifest = `id:${resourceId};request-id:${requestId ?? ''};ts:${timestamp};`
  const digest = input.digest ?? createHmac('sha256', SECRET).update(manifest).digest('hex')
  return `ts=${timestamp},v1=${digest}`
}

describe('verifyMercadoPagoSignature', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    delete process.env.MERCADO_PAGO_WEBHOOK_TOLERANCE_SECONDS
  })

  afterEach(() => {
    vi.useRealTimers()
    delete process.env.MERCADO_PAGO_WEBHOOK_TOLERANCE_SECONDS
  })

  it('accepts the existing id/request-id/timestamp manifest', () => {
    expect(verifyMercadoPagoSignature({
      resourceId: RESOURCE_ID,
      requestId: REQUEST_ID,
      signatureHeader: signature(),
      secret: SECRET,
    })).toBe(true)
  })

  it('rejects a signature computed for a different manifest', () => {
    expect(verifyMercadoPagoSignature({
      resourceId: RESOURCE_ID,
      requestId: REQUEST_ID,
      signatureHeader: signature({ resourceId: 'another-resource' }),
      secret: SECRET,
    })).toBe(false)
  })

  it('keeps an absent request ID as an empty manifest segment', () => {
    expect(verifyMercadoPagoSignature({
      resourceId: RESOURCE_ID,
      requestId: null,
      signatureHeader: signature({ requestId: null }),
      secret: SECRET,
    })).toBe(true)
  })

  it('rejects stale timestamps only when replay tolerance is enabled', () => {
    const oldTimestamp = String(Math.floor(NOW.getTime() / 1_000) - 301)
    const oldSignature = signature({ timestamp: oldTimestamp })

    expect(verifyMercadoPagoSignature({
      resourceId: RESOURCE_ID,
      requestId: REQUEST_ID,
      signatureHeader: oldSignature,
      secret: SECRET,
    })).toBe(true)

    process.env.MERCADO_PAGO_WEBHOOK_TOLERANCE_SECONDS = '300'
    expect(verifyMercadoPagoSignature({
      resourceId: RESOURCE_ID,
      requestId: REQUEST_ID,
      signatureHeader: oldSignature,
      secret: SECRET,
    })).toBe(false)
  })

  it('returns false instead of throwing for different digest buffer lengths', () => {
    expect(verifyMercadoPagoSignature({
      resourceId: RESOURCE_ID,
      requestId: REQUEST_ID,
      signatureHeader: signature({ digest: 'ab' }),
      secret: SECRET,
    })).toBe(false)
  })
})
