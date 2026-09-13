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

it('packs short, simultaneous and crossing bookings/blocks into disjoint targets of at least 44 by 44', () => {
  const bookings = [booking('Ana', '09:00', '09:05'), booking('Beto', '09:00', '10:00'), booking('Carla', '09:10', '09:15'), booking('Dani', '23:55', '23:59')]
  const timeBlocks = [{ id: 'block1', startDateTime: at('09:00'), endDateTime: at('09:05'), reason: 'Limpieza' }, { id: 'block2', startDateTime: at('09:05'), endDateTime: at('09:20'), reason: 'Descanso' }]
  const document = new DOMParser().parseFromString(renderToStaticMarkup(<CalendarViews {...props} view="day" bookings={bookings} timeBlocks={timeBlocks} />), 'text/html')
  const targets = [...document.querySelectorAll<HTMLButtonElement>('button[style*="top:"]')]
  expect(targets).toHaveLength(6)
  const rects = targets.map(target => {
    const columnWidth = parseFloat(target.parentElement!.parentElement!.style.minWidth) || 128
    const percentage = (style: string) => Number(style.match(/([\d.]+)%/)?.[1] || 0)
    const width = percentage(target.style.width) * columnWidth / 100 - 4
    const height = parseFloat(target.style.height)
    expect(height).toBeGreaterThanOrEqual(44)
    expect(width).toBeGreaterThanOrEqual(44)
    const x = percentage(target.style.left) * columnWidth / 100 + 2
    const y = parseFloat(target.style.top)
    expect(y + height).toBeLessThanOrEqual(parseFloat(target.parentElement!.style.height))
    return { x, y, right: x + width, bottom: y + height }
  })
  for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
    const a = rects[i], b = rects[j]
    expect(a.right <= b.x || b.right <= a.x || a.bottom <= b.y || b.bottom <= a.y).toBe(true)
  }
})

it('gives monthly appointment and day links separate 44 px targets instead of overlapping stretched links', () => {
  const document = new DOMParser().parseFromString(renderToStaticMarkup(<CalendarViews {...props} view="month" bookings={[booking('Ana', '09:00', '09:05')]} timeBlocks={[]} />), 'text/html')
  const appointment = document.querySelector('button[aria-label^="Ana —"]')!
  expect(appointment.classList.contains('min-h-11')).toBe(true)
  const dayLink = document.querySelector('a[aria-label="Ver martes 30 de junio"]')!
  expect(dayLink.classList.contains('min-h-11')).toBe(true)
  expect(dayLink.classList.contains('absolute')).toBe(false)
})

it('opens each simultaneous appointment/block with its original duration, not the enlarged hit area', async () => {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const bookings = [booking('Ana', '09:00', '09:05'), booking('Beto', '09:00', '09:10')]
  const timeBlocks = [{ id: 'block1', startDateTime: at('09:00'), endDateTime: at('09:05'), reason: 'Limpieza' }]
  try {
    await act(async () => root.render(<CalendarViews {...props} view="day" bookings={bookings} timeBlocks={timeBlocks} />))
    for (const item of bookings) {
      const target = [...host.querySelectorAll<HTMLButtonElement>('button')].find(button => button.getAttribute('aria-label')?.includes(`— ${item.id} —`))!
      await act(async () => target.click())
      expect(host.querySelector('output[aria-label="Detalle abierto"]')?.textContent).toBe(`${item.id} ${item.endDateTime}`)
    }
    await act(async () => (host.querySelector('button[aria-label="Bloqueo: Limpieza"]') as HTMLButtonElement).click())
    expect(host.querySelector('output[aria-label="Bloqueo abierto"]')?.textContent).toBe('block1 2026-06-30T09:05:00Z')
  } finally {
    await act(async () => root.unmount())
    host.remove()
  }
})
