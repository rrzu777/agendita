import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { SetupChecklist } from '@/components/dashboard/setup-checklist'
import { getBusinessPublicUrl } from '@/lib/business/urls'
import { buildSetupChecklist } from '@/lib/dashboard/setup-checklist'

const business = {
  id: 'biz-1',
  name: 'Centro Alma',
  slug: 'centro-alma',
  subdomain: 'centroalma',
  city: 'Santiago',
  depositPolicy: null,
  cancellationPolicy: null,
}

describe('dashboard setup checklist', () => {
  it('keeps both copy controls and WhatsApp at least 44px', () => {
    const checklist = buildSetupChecklist({
      business,
      servicesCount: 1,
      availabilityCount: 1,
      bookingsCount: 1,
      hasConnectedPaymentAccount: true,
      publicUrl: getBusinessPublicUrl(business),
      bookingUrl: getBusinessPublicUrl(business, '/book'),
    })
    const document = new DOMParser().parseFromString(
      renderToStaticMarkup(createElement(SetupChecklist, { checklist })),
      'text/html',
    )

    for (const name of ['Copiar perfil', 'Copiar reserva', 'WhatsApp']) {
      const control = Array.from(document.querySelectorAll<HTMLElement>('button, a'))
        .find((candidate) => candidate.textContent?.trim() === name)
      expect(control, name).toBeDefined()
      expect(control?.classList.contains('min-h-11'), name).toBe(true)
      expect(control?.classList.contains('min-w-11'), name).toBe(true)
    }
  })

  it('shows pending items for missing services, schedule, booking, payments and cancellation policy', () => {
    const checklist = buildSetupChecklist({
      business,
      servicesCount: 0,
      availabilityCount: 0,
      bookingsCount: 0,
      hasConnectedPaymentAccount: false,
      publicUrl: getBusinessPublicUrl(business),
      bookingUrl: getBusinessPublicUrl(business, '/book'),
    })

    expect(checklist.completedCount).toBe(2)
    expect(checklist.totalCount).toBe(7)
    expect(checklist.isReady).toBe(false)
    expect(checklist.items.filter((item) => !item.completed).map((item) => item.key)).toEqual([
      'services',
      'schedule',
      'first_booking',
      'payments',
      'cancellation_policy',
    ])
  })

  it('uses helper/env generated links instead of a hardcoded production domain', () => {
    const checklist = buildSetupChecklist({
      business,
      servicesCount: 1,
      availabilityCount: 1,
      bookingsCount: 1,
      hasConnectedPaymentAccount: true,
      publicUrl: getBusinessPublicUrl(business),
      bookingUrl: getBusinessPublicUrl(business, '/book'),
    })

    expect(checklist.publicUrl).toBe(getBusinessPublicUrl(business))
    expect(checklist.bookingUrl).toBe(getBusinessPublicUrl(business, '/book'))
    expect(checklist.publicUrl).not.toContain('agendita.com')
    expect(checklist.bookingUrl).not.toContain('agendita.com')
  })

  it('does not mark ready without services or schedules', () => {
    const checklist = buildSetupChecklist({
      business: { ...business, depositPolicy: 'Transferencia previa.', cancellationPolicy: 'Avisar con 24 horas.' },
      servicesCount: 0,
      availabilityCount: 0,
      bookingsCount: 1,
      hasConnectedPaymentAccount: true,
      publicUrl: getBusinessPublicUrl(business),
      bookingUrl: getBusinessPublicUrl(business, '/book'),
    })

    expect(checklist.completedCount).toBe(5)
    expect(checklist.isReady).toBe(false)
  })
})
