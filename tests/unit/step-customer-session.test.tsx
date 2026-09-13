import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { StepCustomer } from '@/components/booking/step-customer'
import type { BookingData } from '@/components/booking/wizard'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { clickButton } from '../helpers/react-dom'
import { isRedirectError } from 'next/dist/client/components/redirect-error'
import { getRedirectError } from 'next/dist/client/components/redirect'
import { RedirectType } from 'next/navigation'
const rethrow = vi.hoisted(() => vi.fn())
vi.mock('next/navigation', async importOriginal => ({ ...await importOriginal<typeof import('next/navigation')>(), unstable_rethrow: rethrow }))

const data: BookingData = {
  serviceId: 's1', serviceName: 'Manicure', servicePrice: 20000, serviceDuration: 60,
  serviceDeposit: 0, serviceColor: '',
  serviceModalities: ['on_site'], serviceModality: 'on_site', serviceAddress: '', date: null, timeSlot: null,
  customerName: 'Maria', customerPhone: '+56911111111', customerEmail: 'maria@example.com',
  professional: { kind: 'none' }, professionalName: '',
  customerNotes: '', idempotencyKey: null,
}
const noop = vi.fn()

describe('StepCustomer con sesión', () => {
  it('delegates redirect control flow before reporting a Google transport error', async () => {
    const host = document.createElement('div')
    const root = createRoot(host)
    const redirect = getRedirectError('/ingresar', RedirectType.push)
    expect(isRedirectError(redirect)).toBe(true)
    rethrow.mockClear()
    try {
      await act(async () => root.render(<StepCustomer data={data} sessionEmail={null} onLoginCta={async () => { throw redirect }} onSubmit={noop} onBack={noop} />))
      await clickButton(host, 'Continuar con Google')
      expect(rethrow).toHaveBeenCalledWith(redirect)
    } finally { await act(async () => root.unmount()) }
  })
  it('submits a guest with no optional contact fields and leaves extra inputs collapsed', async () => {
    const host = document.createElement('div')
    const root = createRoot(host)
    const submit = vi.fn()
    const guest = { ...data, customerEmail: '', customerBirthDate: '', customerNotes: '' }
    try {
      await act(async () => root.render(<StepCustomer data={guest} sessionEmail={null} onLoginCta={noop} onSubmit={submit} onBack={noop} />))
      expect(host.querySelector<HTMLInputElement>('#booking-customer-phone')?.required).toBe(true)
      expect(host.querySelector<HTMLInputElement>('#booking-customer-email')?.required).toBe(false)
      expect(host.querySelector<HTMLInputElement>('#booking-customer-birthdate')?.required).toBe(false)
      expect(host.querySelector('#booking-customer-birthdate')?.closest('details')?.open).toBe(false)
      await act(async () => { host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })
      expect(submit).toHaveBeenCalledWith(expect.objectContaining({ customerName: 'Maria', customerPhone: '+56911111111', customerEmail: '', customerBirthDate: '', customerNotes: '' }))
    } finally { await act(async () => root.unmount()) }
  })

  it('preserves contact details for Google and leaves guest submission available if login fails', async () => {
    const host = document.createElement('div')
    const root = createRoot(host)
    const login = vi.fn().mockRejectedValue(new Error('network'))
    const submit = vi.fn()
    try {
      await act(async () => root.render(<StepCustomer data={data} sessionEmail={null} onLoginCta={login} onSubmit={submit} onBack={noop} />))
      await clickButton(host, 'Continuar con Google')
      expect(login).toHaveBeenCalledWith(expect.objectContaining({ customerName: 'Maria', customerEmail: 'maria@example.com' }))
      expect(host.querySelector('[role="alert"]')?.textContent).toContain('reservar sin cuenta')
      expect(host.querySelector<HTMLInputElement>('#booking-customer-name')?.value).toBe('Maria')
      await act(async () => { host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })
      expect(submit).toHaveBeenCalledOnce()
    } finally { await act(async () => root.unmount()) }
  })
  it('offers Google without requiring an existing account and keeps guest booking available', () => {
    const html = renderToStaticMarkup(
      <StepCustomer data={{ ...data, customerName: '', customerPhone: '', customerEmail: '' }} sessionEmail={null} onLoginCta={noop} onSubmit={noop} onBack={noop} />,
    )
    expect(html).toContain('Continuar con Google')
    expect(html).toContain('sin cuenta')
    expect(html).toContain('Obligatorio')
    expect(html).toContain('Opcional')
    expect(html).not.toContain('Continuar al pago')
  })

  it('con sesión: muestra "Reservando como" + "No soy yo" y NO el banner', () => {
    const html = renderToStaticMarkup(
      <StepCustomer data={data} sessionEmail="maria@example.com" onLoginCta={noop} onSubmit={noop} onBack={noop} />,
    )
    expect(html).toContain('Reservando como maria@example.com')
    expect(html).toContain('No soy yo')
    expect(html).not.toContain('¿Ya tienes cuenta?')
  })
})
