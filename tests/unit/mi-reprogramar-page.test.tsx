import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

const { mockGetCurrentUser, mockBookingFindFirst, mockRedirect, mockNotFound } = vi.hoisted(() => ({
  mockGetCurrentUser: vi.fn(),
  mockBookingFindFirst: vi.fn(),
  mockRedirect: vi.fn((path: string) => { throw new Error(`REDIRECT:${path}`) }),
  mockNotFound: vi.fn(() => { throw new Error('NOT_FOUND') }),
}))

vi.mock('@/lib/auth/user', () => ({ getCurrentUser: mockGetCurrentUser }))
vi.mock('@/lib/db', () => ({
  prisma: { booking: { findFirst: mockBookingFindFirst } },
}))
vi.mock('next/navigation', () => ({
  redirect: mockRedirect,
  notFound: mockNotFound,
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}))
vi.mock('@/server/actions/my-bookings', () => ({
  getMyRescheduleSlots: vi.fn(),
  rescheduleMyBooking: vi.fn(),
}))

import ReprogramarPage from '@/app/mi/[slug]/reservas/[bookingId]/reprogramar/page'

const params = Promise.resolve({ slug: 'salon-ana', bookingId: 'bk1' })

describe('/mi/[slug]/reservas/[bookingId]/reprogramar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('sin sesión → redirect a /ingresar?next=/mi', async () => {
    mockGetCurrentUser.mockResolvedValue(null)
    await expect(ReprogramarPage({ params })).rejects.toThrow('REDIRECT:/ingresar?next=/mi')
    expect(mockRedirect).toHaveBeenCalledWith('/ingresar?next=/mi')
  })

  it('reserva no encontrada (ajena o inexistente) → notFound', async () => {
    mockGetCurrentUser.mockResolvedValue({ id: 'u1' })
    mockBookingFindFirst.mockResolvedValue(null)
    await expect(ReprogramarPage({ params })).rejects.toThrow('NOT_FOUND')
    expect(mockNotFound).toHaveBeenCalled()
  })

  it('reserva propia pero fuera de ventana → mensaje de política, sin formulario', async () => {
    mockGetCurrentUser.mockResolvedValue({ id: 'u1' })
    mockBookingFindFirst.mockResolvedValue({
      id: 'bk1',
      startDateTime: new Date(Date.now() + 2 * 3_600_000), // en 2h
      service: { name: 'Manicura' },
      business: { slug: 'salon-ana', name: 'Salón Ana', timezone: 'America/Santiago', selfServiceCutoffHours: 24 },
    })
    const html = renderToStaticMarkup(await ReprogramarPage({ params }))
    expect(html.toLowerCase()).toContain('hasta 24 horas antes')
    expect(html).not.toContain('<form')
  })

  it('reserva propia dentro de ventana → renderiza el formulario', async () => {
    mockGetCurrentUser.mockResolvedValue({ id: 'u1' })
    mockBookingFindFirst.mockResolvedValue({
      id: 'bk1',
      startDateTime: new Date(Date.now() + 72 * 3_600_000), // en 72h
      service: { name: 'Manicura' },
      business: { slug: 'salon-ana', name: 'Salón Ana', timezone: 'America/Santiago', selfServiceCutoffHours: 24 },
    })
    const html = renderToStaticMarkup(await ReprogramarPage({ params }))
    expect(html).toContain('Manicura')
  })
})
