import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it, vi } from 'vitest'

const { getUser, getBookings, getBlocks, getProfessionals } = vi.hoisted(() => ({
  getUser: vi.fn(),
  getBookings: vi.fn().mockResolvedValue([]),
  getBlocks: vi.fn(),
  getProfessionals: vi.fn().mockResolvedValue([]),
}))

vi.mock('@/lib/auth/user', () => ({ getCurrentUserWithBusiness: getUser }))
vi.mock('@/server/actions/bookings', () => ({ getBookingsByRange: getBookings }))
vi.mock('@/server/actions/time-blocks', () => ({ getTimeBlocksByRange: getBlocks }))
vi.mock('@/server/actions/professionals', () => ({ getProfessionalNames: getProfessionals }))
vi.mock('@/lib/storage/r2', () => ({ isObjectStorageAvailable: () => false }))
vi.mock('next/navigation', () => ({ redirect: vi.fn() }))
vi.mock('@/components/dashboard/calendar-views', () => ({
  CalendarViews: ({ timeBlocks }: { timeBlocks: unknown[] }) => (
    <output aria-label="Bloqueos serializados">{JSON.stringify(timeBlocks)}</output>
  ),
}))

import CalendarPage from '@/app/dashboard/calendar/page'

it('preserva la tolerancia del bloqueo al serializarlo hacia el editor del calendario', async () => {
  getUser.mockResolvedValue({
    user: { id: 'user-1' },
    business: { id: 'business-1', timezone: 'America/Santiago', currency: 'CLP', addressText: null },
  })
  getBlocks.mockResolvedValue([{
    id: 'block-1',
    startDateTime: new Date('2026-06-29T10:00:00Z'),
    endDateTime: new Date('2026-07-02T10:00:00Z'),
    reason: 'Vacaciones',
    overlapToleranceMinutes: 5,
    professionalId: null,
    seriesId: undefined,
    occurrenceDate: null,
  }])

  const html = renderToStaticMarkup(await CalendarPage({ searchParams: Promise.resolve({ view: 'day', date: '2026-07-01' }) }))
  const document = new DOMParser().parseFromString(html, 'text/html')
  expect(document.querySelector('[aria-label="Bloqueos serializados"]')?.textContent).toContain('"overlapToleranceMinutes":5')
})
