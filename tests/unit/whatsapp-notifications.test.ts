import { describe, it, expect } from 'vitest'
import {
  buildWhatsappReminderMessage,
  buildWhatsappReminderUrl,
} from '@/lib/notifications/whatsapp'

const baseData = {
  customerName: 'Maria',
  customerPhone: '56912345678',
  serviceName: 'Manicure',
  startDateTime: new Date('2026-06-15T14:00:00-04:00'),
  businessTimezone: 'America/Santiago',
  businessCurrency: 'CLP',
  totalPrice: 20000,
  depositPaid: 5000,
  remainingBalance: 15000,
  businessAddress: 'Av. Principal 123',
}

describe('buildWhatsappReminderMessage', () => {
  it('includes date, time and service name', () => {
    const msg = buildWhatsappReminderMessage(baseData)

    expect(msg).toContain('Maria')
    expect(msg).toContain('Manicure')
    expect(msg).toContain('junio')
  })

  it('includes remaining balance when > 0', () => {
    const msg = buildWhatsappReminderMessage(baseData)

    expect(msg).toContain('Saldo pendiente')
    expect(msg).toContain('15.000')
  })

  it('omits remaining balance when 0', () => {
    const msg = buildWhatsappReminderMessage({
      ...baseData,
      depositPaid: 20000,
      remainingBalance: 0,
    })

    expect(msg).not.toContain('Saldo pendiente')
  })

  it('includes business address when available', () => {
    const msg = buildWhatsappReminderMessage(baseData)

    expect(msg).toContain('Av. Principal 123')
  })

  it('omits business address when null', () => {
    const msg = buildWhatsappReminderMessage({
      ...baseData,
      businessAddress: null,
    })

    expect(msg).not.toContain('Dirección')
  })

  it('includes price and deposit info', () => {
    const msg = buildWhatsappReminderMessage(baseData)

    expect(msg).toContain('20.000')
    expect(msg).toContain('5.000')
  })
})

describe('buildWhatsappReminderUrl', () => {
  it('generates valid wa.me URL', () => {
    const url = buildWhatsappReminderUrl('56912345678', baseData)

    expect(url).toContain('https://wa.me/56912345678')
    expect(url).toContain('?text=')
  })

  it('encoded message is decodable and contains key info', () => {
    const url = buildWhatsappReminderUrl('56912345678', baseData)
    const decoded = decodeURIComponent(url.split('?text=')[1])

    expect(decoded).toContain('Maria')
    expect(decoded).toContain('Manicure')
    expect(decoded).toContain('junio')
  })

  it('sanitizes phone number', () => {
    const url = buildWhatsappReminderUrl('+56 9 1234 5678', baseData)

    expect(url).toContain('https://wa.me/56912345678')
    expect(url).not.toContain('+')
    expect(url).not.toContain(' ')
  })

  it('generates URL when remaining balance is 0', () => {
    const url = buildWhatsappReminderUrl('56912345678', {
      ...baseData,
      depositPaid: 20000,
      remainingBalance: 0,
    })

    const decoded = decodeURIComponent(url.split('?text=')[1])
    expect(decoded).not.toContain('Saldo pendiente')
  })
})
