import { describe, expect, it } from 'vitest'
import { analyticsEventSchema } from '@/lib/analytics/contracts'
import { normalizeAcquisition } from '@/lib/analytics/attribution'

const base = { version: 1, eventId: '59f1ff5d-bf6f-4b96-b6e0-1be52096731a', sequence: 1, selectionRevision: 1 }
const context = { serviceId: 'service-a', modality: 'on_site', professional: { kind: 'none' } }
describe('closed analytics inputs', () => {
  it('accepts service interest before modality is resolved', () => {
    expect(analyticsEventSchema.safeParse({ ...base, type: 'service_considered', data: { serviceId: 'service-a' } }).success).toBe(true)
  })
  it('rejects PII, client identities, timestamps and unknown properties', () => {
    for (const extra of [{ data: { email: 'fixture@example.invalid' } }, { businessId: 'other' }, { occurredAt: '2026-01-01' }]) {
      expect(analyticsEventSchema.safeParse({ ...base, type: 'customer_step_completed', data: {}, ...extra }).success).toBe(false)
    }
  })
  it('validates real calendar dates but permits outside-booking-window observations', () => {
    for (const [localDate, want] of [['2028-02-29', true], ['2100-12-31', true], ['2026-02-29', false], ['2101-01-01', false]] as const) {
      expect(analyticsEventSchema.safeParse({ ...base, type: 'date_selected', data: { ...context, localDate } }).success).toBe(want)
    }
  })
  it('rejects exact appointment time and professional IDs outside person choice', () => {
    expect(analyticsEventSchema.safeParse({ ...base, type: 'time_selected', data: { ...context, localDate: '2026-09-01', timeBucket: '12_18' } }).success).toBe(true)
    expect(analyticsEventSchema.safeParse({ ...base, type: 'time_selected', data: { ...context, localDate: '2026-09-01', timeBucket: '12:30' } }).success).toBe(false)
    expect(analyticsEventSchema.safeParse({ ...base, type: 'professional_selected', data: { ...context, professional: { kind: 'anyone', professionalId: 'p' } } }).success).toBe(false)
  })
  it('closes payment, availability and authoritative-result vocabularies', () => {
    expect(analyticsEventSchema.safeParse({ ...base, type: 'payment_branch_viewed', data: { screen: 'sin-pago-online', condition: 'deposit_required', offeredMethods: ['transfer', 'manual'] } }).success).toBe(true)
    expect(analyticsEventSchema.safeParse({ ...base, type: 'booking_confirmed', data: {} }).success).toBe(false)
    expect(analyticsEventSchema.safeParse({ ...base, type: 'availability_result', data: { ...context, localDate: '2026-09-01', queryId: base.eventId, requestGeneration: 100001, result: 'empty', reason: 'unknown' } }).success).toBe(false)
  })
  it('normalizes acquisition without retaining arbitrary UTM, URLs or unverified links', () => {
    expect(normalizeAcquisition({ utmSource: 'InStaGram', referrer: 'https://evil.invalid/private', acquisitionLinkId: 'unverified' })).toEqual({ channel: 'instagram', normalizationVersion: 1, acquisitionLinkId: null })
    expect(normalizeAcquisition({ utmSource: 'someone@example.invalid' })).toEqual({ channel: 'unknown', normalizationVersion: 1, acquisitionLinkId: null })
    expect(normalizeAcquisition({ verifiedLink: { id: 'link-a', channel: 'whatsapp' }, utmSource: 'google' })).toEqual({ channel: 'whatsapp', normalizationVersion: 1, acquisitionLinkId: 'link-a' })
    expect(normalizeAcquisition({})).toEqual({ channel: 'direct', normalizationVersion: 1, acquisitionLinkId: null })
  })
  it.each(['constructor', '__proto__'])('maps inherited object key %s to unknown acquisition', (utmSource) => {
    expect(normalizeAcquisition({ utmSource })).toEqual({ channel: 'unknown', normalizationVersion: 1, acquisitionLinkId: null })
  })
})
