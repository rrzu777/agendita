// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { readAnalyticsBody, canonicalAnalyticsFingerprint, parseAnalyticsBatch } from '@/lib/analytics/ingest'

describe('strict bounded capture input', () => {
  const request = (body: string, headers = {}) => new Request('https://salon.agendita.test/api/analytics/salon/events', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body })
  it('parses JSON only inside the real UTF-8 byte budget', async () => {
    expect(await readAnalyticsBody(request('{"consentVersion":1}'))).toEqual({ consentVersion: 1 })
    await expect(readAnalyticsBody(request(JSON.stringify({ value: 'á'.repeat(9000) }), { 'content-length': '1' }))).rejects.toMatchObject({ category: 'invalid_request' })
  })
  it('stops and cancels a chunked body immediately when bytes exceed 16 KiB', async () => {
    const cancel = vi.fn()
    let pulled = 0
    const body = new ReadableStream({ pull(controller) { pulled++; controller.enqueue(new Uint8Array(9000)) }, cancel })
    const req = new Request('https://example.test', { method: 'POST', body, duplex: 'half', headers: { 'content-type': 'application/json' } } as RequestInit)
    await expect(readAnalyticsBody(req)).rejects.toMatchObject({ category: 'invalid_request' })
    expect(cancel).toHaveBeenCalledOnce()
    expect(pulled).toBeLessThanOrEqual(3)
  })
  it('rejects unexpected content types, invalid JSON and invalid UTF-8', async () => {
    await expect(readAnalyticsBody(request('{}', { 'content-type': 'text/plain' }))).rejects.toMatchObject({ category: 'invalid_request' })
    await expect(readAnalyticsBody(request('{'))).rejects.toMatchObject({ category: 'invalid_request' })
    await expect(readAnalyticsBody(new Request('https://example.test', { method: 'POST', body: new Uint8Array([255]), headers: { 'content-type': 'application/json' } }))).rejects.toMatchObject({ category: 'invalid_request' })
  })
  it('rejects extra envelope keys and batches over 20 events', () => {
    expect(() => parseAnalyticsBatch({ credential: 'x', events: Array(21).fill({}) })).toThrow()
    expect(() => parseAnalyticsBatch({ credential: 'x', events: [{}], businessId: 'other' })).toThrow()
    expect(parseAnalyticsBatch({ credential: 'x', events: [{}] })).toEqual({ credential: 'x', events: [{}] })
  })
  it('canonical fingerprints ignore JSON ordering but include identity, sequence and revision', () => {
    const a = { version: 1, eventId: 'abc', sequence: 1, type: 'service_considered', selectionRevision: 1, data: { serviceId: 'service-a' } }
    expect(canonicalAnalyticsFingerprint(a)).toBe(canonicalAnalyticsFingerprint({ data: { serviceId: 'service-a' }, selectionRevision: 1, type: 'service_considered', sequence: 1, eventId: 'abc', version: 1 }))
    expect(canonicalAnalyticsFingerprint(a)).not.toBe(canonicalAnalyticsFingerprint({ ...a, sequence: 2 }))
  })
})
