import { expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { CalendarViews, type TimelineBooking } from '@/components/dashboard/calendar-views'

vi.mock('@/components/dashboard/block-time-modal', () => ({ BlockTimeModal: () => null }))
vi.mock('@/components/dashboard/booking-drawer', () => ({ BookingDrawer: ({ booking }: { booking: { id: string; endDateTime: string } }) => <output aria-label="Detalle abierto">{booking.id} {booking.endDateTime}</output> }))
vi.mock('@/components/dashboard/edit-block-dialog', () => ({ EditBlockDialog: ({ block }: { block: { id: string; endDateTime: string } }) => <output aria-label="Bloqueo abierto">{block.id} {block.endDateTime}</output> }))
vi.mock('@/components/dashboard/edit-series-occurrence-dialog', () => ({ EditSeriesOccurrenceDialog: () => null }))

const props = { selectedProfessionalId: null, now: new Date('2026-06-30T10:00:00Z'), timezone: 'UTC', businessCurrency: 'CLP', businessAddress: null, photoUploadEnabled: false, professionals: [], date: '2026-06-30' }
const at = (time: string) => `2026-06-30T${time}:00Z`
const booking = (id: string, start: string, end: string): TimelineBooking => ({ id, bookingNumber: null, startDateTime: at(start), endDateTime: at(end), status: 'confirmed', customer: { name: id, phone: '56912345678', email: null }, service: { name: 'Corte' }, professional: null, paymentStatus: 'unpaid', holdExpiresAt: null, approvalExpiresAt: null, payments: [], totalPrice: 10000, depositPaid: 0, depositRequired: 0, finalAmount: 10000, remainingBalance: 10000, modality: 'on_site' })

it('pinta intervalos reales y ofrece acciones equivalentes de 44 px para citas y bloqueos breves', () => {
  const bookings = [booking('Ana', '11:30', '11:50'), booking('Beto', '12:00', '13:30'), booking('Carla', '23:55', '23:59')]
  const timeBlocks = [{ id: 'block1', startDateTime: at('11:50'), endDateTime: at('11:55'), reason: 'Limpieza', professionalName: 'Paula' }]
  const document = new DOMParser().parseFromString(renderToStaticMarkup(<CalendarViews {...props} view="day" bookings={bookings} timeBlocks={timeBlocks} />), 'text/html')
  const anaBand = document.querySelector<HTMLElement>('[data-booking-id="Ana"]')!
  const betoButton = document.querySelector<HTMLButtonElement>('[data-booking-id="Beto"]')!
  const blockBand = document.querySelector<HTMLElement>('[data-time-block-id="block1"]')!
  expect(anaBand.tagName).toBe('DIV')
  expect(parseFloat(anaBand.style.height)).toBeCloseTo(20 / 60 * 56, 4)
  expect(parseFloat(anaBand.style.top) + parseFloat(anaBand.style.height)).toBeLessThan(4 * 56)
  expect(betoButton.tagName).toBe('BUTTON')
  expect(parseFloat(betoButton.style.height)).toBe(90 / 60 * 56)
  expect(blockBand.tagName).toBe('DIV')

  const disclosure = document.querySelector('[data-slot="brief-calendar-events"]')!
  expect(disclosure.querySelector('summary')?.textContent).toContain('Citas breves y bloqueos (3)')
  const equivalentActions = [...disclosure.querySelectorAll<HTMLButtonElement>('button')]
  expect(equivalentActions).toHaveLength(3)
  expect(equivalentActions.every((button) => button.classList.contains('min-h-11'))).toBe(true)
  expect(disclosure.textContent).toContain('11:30–11:50')
  expect(disclosure.textContent).toContain('Paula')
  expect(disclosure.textContent).toContain('23:55–23:59')
})

it('gives monthly appointment and day links separate 44 px targets instead of overlapping stretched links', () => {
  const document = new DOMParser().parseFromString(renderToStaticMarkup(<CalendarViews {...props} view="month" bookings={[booking('Ana', '09:00', '09:05')]} timeBlocks={[]} />), 'text/html')
  const appointment = document.querySelector('button[aria-label^="Ana —"]')!
  expect(appointment.classList.contains('min-h-11')).toBe(true)
  const dayLink = document.querySelector('a[aria-label="Ver martes 30 de junio"]')!
  expect(dayLink.classList.contains('min-h-11')).toBe(true)
  expect(dayLink.classList.contains('absolute')).toBe(false)
})

it('opens each brief appointment/block with its original duration from the equivalent actions', async () => {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const bookings = [booking('Ana', '09:00', '09:05'), booking('Beto', '09:00', '09:10')]
  const timeBlocks = [{ id: 'block1', startDateTime: at('09:00'), endDateTime: at('09:05'), reason: 'Limpieza' }]
  try {
    await act(async () => root.render(<CalendarViews {...props} view="day" bookings={bookings} timeBlocks={timeBlocks} />))
    const disclosure = host.querySelector('[data-slot="brief-calendar-events"]')!
    for (const item of bookings) {
      const target = [...disclosure.querySelectorAll<HTMLButtonElement>('button')].find(button => button.getAttribute('aria-label')?.includes(item.id))!
      await act(async () => target.click())
      expect(host.querySelector('output[aria-label="Detalle abierto"]')?.textContent).toBe(`${item.id} ${item.endDateTime}`)
    }
    await act(async () => ([...disclosure.querySelectorAll<HTMLButtonElement>('button')].find(button => button.getAttribute('aria-label')?.includes('Limpieza'))!).click())
    expect(host.querySelector('output[aria-label="Bloqueo abierto"]')?.textContent).toBe('block1 2026-06-30T09:05:00Z')
  } finally {
    await act(async () => root.unmount())
    host.remove()
  }
})

it('pinta ambos tramos nocturnos con geometría real, un conteo único y contexto de continuación', () => {
  const overnight = {
    ...booking('Nocturna', '23:55', '23:59'),
    endDateTime: '2026-07-01T00:10:00Z',
  }
  const document = new DOMParser().parseFromString(renderToStaticMarkup(
    <CalendarViews {...props} view="week" bookings={[overnight]} timeBlocks={[]} />,
  ), 'text/html')
  const first = document.querySelector<HTMLElement>('[data-calendar-day="2026-06-30"] [data-booking-id="Nocturna"]')!
  const second = document.querySelector<HTMLElement>('[data-calendar-day="2026-07-01"] [data-booking-id="Nocturna"]')!
  expect(parseFloat(first.style.height)).toBeCloseTo(5 / 60 * 56, 4)
  expect(parseFloat(second.style.height)).toBeCloseTo(10 / 60 * 56, 4)
  expect(second.getAttribute('aria-label')).toContain('Continúa desde el día anterior')
  expect(second.getAttribute('aria-label')).toContain('Horario completo')
  const disclosure = document.querySelector('[data-slot="brief-calendar-events"]')!
  expect(disclosure.querySelector('summary')?.textContent).toContain('Citas breves y bloqueos (1)')
  expect(disclosure.querySelectorAll('button')).toHaveLength(2)
})

it('incluye un bloqueo multiday que comenzó antes y una cita regular en lanes reales', () => {
  const timeBlocks = [{
    id: 'vacaciones',
    startDateTime: '2026-06-29T10:00:00Z',
    endDateTime: '2026-07-02T10:00:00Z',
    reason: 'Vacaciones',
    professionalName: 'Paula',
  }]
  const regular = {
    ...booking('Solape', '09:00', '10:00'),
    startDateTime: '2026-07-01T09:00:00Z',
    endDateTime: '2026-07-01T10:00:00Z',
  }
  const document = new DOMParser().parseFromString(renderToStaticMarkup(
    <CalendarViews {...props} date="2026-07-01" view="day" bookings={[regular]} timeBlocks={timeBlocks} />,
  ), 'text/html')
  const day = document.querySelector('[data-calendar-day="2026-07-01"]')!
  const block = day.querySelector<HTMLElement>('[data-time-block-id="vacaciones"]')!
  const appointment = day.querySelector<HTMLElement>('[data-booking-id="Solape"]')!
  expect(parseFloat(block.style.height)).toBe(24 * 56)
  expect(block.style.width).toContain('50%')
  expect(appointment.style.width).toContain('50%')
  expect(block.getAttribute('aria-label')).toContain('Horario completo')
})

it('mide por tiempo real una cita que cruza la hora repetida de Santiago', () => {
  const repeated = {
    ...booking('Repetida', '09:00', '10:00'),
    startDateTime: '2026-04-05T02:30:00Z',
    endDateTime: '2026-04-05T03:45:00Z',
  }
  const document = new DOMParser().parseFromString(renderToStaticMarkup(
    <CalendarViews {...props} timezone="America/Santiago" date="2026-04-04" view="day" bookings={[repeated]} timeBlocks={[]} />,
  ), 'text/html')
  const band = document.querySelector<HTMLElement>('[data-calendar-day="2026-04-04"] [data-booking-id="Repetida"]')!
  expect(parseFloat(band.style.height)).toBe(70)
  const labels = [...document.querySelectorAll('[data-slot="timeline-tick"]')].map((tick) => tick.textContent)
  expect(labels).toContain('23:00 (-03:00)')
  expect(labels).toContain('23:00 (-04:00)')
})

it('lista continuaciones en la agenda móvil y en cada día mensual que tocan', () => {
  const overnight = {
    ...booking('Nocturna', '23:55', '23:59'),
    endDateTime: '2026-07-01T00:10:00Z',
  }
  const weekDocument = new DOMParser().parseFromString(renderToStaticMarkup(
    <CalendarViews {...props} view="week" bookings={[overnight]} timeBlocks={[]} />,
  ), 'text/html')
  const agenda = weekDocument.querySelector('[aria-label="Agenda de la semana"]')!
  expect(agenda.textContent?.match(/Nocturna/g)).toHaveLength(2)
  expect(agenda.textContent).toContain('Continúa desde el día anterior')

  const monthDocument = new DOMParser().parseFromString(renderToStaticMarkup(
    <CalendarViews {...props} view="month" bookings={[overnight]} timeBlocks={[]} />,
  ), 'text/html')
  expect(monthDocument.querySelector('[data-calendar-day="2026-06-30"] button[aria-label^="Nocturna"]')).not.toBeNull()
  expect(monthDocument.querySelector('[data-calendar-day="2026-07-01"] button[aria-label^="Nocturna"]')).not.toBeNull()
})
