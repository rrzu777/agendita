import { renderToStaticMarkup } from 'react-dom/server'
import { describe, it, expect } from 'vitest'
import { ServiceModality } from '@prisma/client'
import { StepConfirmation, type ConfirmationBusiness } from '@/components/booking/step-confirmation'
import type { BookingData } from '@/components/booking/wizard'
import type { WhereFields } from '@/lib/services/modality'

// La confirmación tenía el "cuándo" y el "cuánto", pero no el "dónde": la clienta
// cerraba la pestaña sin la dirección, y el único lugar donde estaba era el mail.
const base = {
  serviceId: 'svc-1',
  serviceName: 'Corte',
  servicePrice: 20000,
  serviceDeposit: 0,
  date: new Date('2026-08-01T12:00:00Z'),
  timeSlot: { start: new Date('2026-08-01T12:00:00Z'), end: new Date('2026-08-01T13:00:00Z') },
  customerName: 'Ana',
  customerPhone: '+56911111111',
  customerEmail: '',
} as unknown as BookingData

const business: ConfirmationBusiness = {
  name: 'Barbería Carlos',
  addressText: 'Santa Isabel 0120, Providencia',
  whatsapp: '+56950624926',
}

// El "dónde" llega de la reserva que devolvió el servidor, no del estado del wizard.
const enElLocal: WhereFields = { modality: ServiceModality.on_site, serviceAddress: null, meetingUrl: null }

function render(where: WhereFields = enElLocal, biz: ConfirmationBusiness = business) {
  return renderToStaticMarkup(
    <StepConfirmation
      timezone="America/Santiago" currency="CLP" data={base} bookingId="clabc12345"
      bookingNumber={4738} mode="paid" promo={null} sessionEmail={null} business={biz} where={where}
    />,
  )
}

describe('StepConfirmation: dónde y con quién hablar', () => {
  it('en el local muestra la dirección, y linkea al mapa', () => {
    const html = render()
    expect(html).toContain('Santa Isabel 0120, Providencia')
    expect(html).toContain('https://www.google.com/maps/search/?api=1&amp;query=Santa%20Isabel%200120%2C%20Providencia')
  })

  it('a domicilio muestra la dirección de la clienta, no la del negocio', () => {
    const html = render({ modality: ServiceModality.at_home, serviceAddress: 'Los Leones 55, dpto 3', meetingUrl: null })
    expect(html).toContain('Los Leones 55, dpto 3')
    expect(html).not.toContain('Santa Isabel 0120')
    // Sin link al mapa: es la casa de la clienta.
    expect(html).not.toContain('maps/search')
  })

  it('online muestra el link de la videollamada', () => {
    const html = render({ modality: ServiceModality.online, serviceAddress: null, meetingUrl: 'https://meet.example/sala' })
    expect(html).toContain('https://meet.example/sala')
    expect(html).not.toContain('Santa Isabel 0120')
  })

  // El alta valida el esquema, pero las filas viejas se guardaron sin esa
  // validación: un `javascript:` como href es un XSS en el navegador de la clienta.
  it('un link de sala que no es http no se vuelve clickeable', () => {
    const html = render({ modality: ServiceModality.online, serviceAddress: null, meetingUrl: 'javascript:alert(1)' })
    expect(html).not.toContain('href="javascript:')
  })

  it('sin dirección cargada no inventa una fila vacía', () => {
    const html = render(enElLocal, { ...business, addressText: null })
    expect(html).not.toContain('Dirección')
  })

  it('el WhatsApp del negocio llega con el número de reserva ya escrito', () => {
    const html = render()
    expect(html).toContain('https://wa.me/56950624926')
    expect(html).toContain('%234738') // "#4738" encodeado en el texto del mensaje
  })

  it('sin WhatsApp cargado no ofrece escribir', () => {
    const html = render(enElLocal, { ...business, whatsapp: null })
    expect(html).not.toContain('wa.me')
  })
})
