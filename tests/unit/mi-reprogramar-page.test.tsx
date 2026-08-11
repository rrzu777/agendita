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
      cancellationCutoffHours: 24,
      cancellationPolicySnapshot: null,
      service: { name: 'Manicura' },
      business: { slug: 'salon-ana', name: 'Salón Ana', timezone: 'America/Santiago', selfServiceCutoffHours: 24, cancellationPolicy: null },
    })
    const html = renderToStaticMarkup(await ReprogramarPage({ params }))
    expect(html.toLowerCase()).toContain('hasta 24 horas antes')
    expect(html).not.toContain('<form')
  })

  it('reserva propia dentro de ventana → renderiza el formulario', async () => {
    mockGetCurrentUser.mockResolvedValue({ id: 'u1' })
    mockBookingFindFirst.mockResolvedValue(dentroDeVentana())
    const html = renderToStaticMarkup(await ReprogramarPage({ params }))
    expect(html).toContain('Manicura')
  })

  // A esta página se llega por URL directa, por un marcador o con el botón Atrás
  // después de que el plazo venciera: la lista ya no ofrece el link. Sin el corte
  // la clienta elegía un horario nuevo para que la action lo rechazara al final.
  it('plazo vencido → mensaje, sin selector de horarios', async () => {
    mockGetCurrentUser.mockResolvedValue({ id: 'u1' })
    mockBookingFindFirst.mockResolvedValue(
      dentroDeVentana({ holdExpiresAt: new Date(Date.now() - 60_000) }),
    )
    const html = renderToStaticMarkup(await ReprogramarPage({ params }))
    expect(html.toLowerCase()).toContain('venció el plazo')
    expect(html).not.toContain('<form')
    // El texto es el de la clienta: nada de Revivir ni de acusarla de no pagar.
    expect(html).not.toContain('para pagar')
  })

  // Con plata adentro el cron no barre nada, así que el plazo vencido no condena
  // a esta reserva y el formulario tiene que seguir apareciendo.
  it('plazo vencido pero con abono pagado → sigue el formulario', async () => {
    mockGetCurrentUser.mockResolvedValue({ id: 'u1' })
    mockBookingFindFirst.mockResolvedValue(
      dentroDeVentana({ paymentStatus: 'deposit_paid', holdExpiresAt: new Date(Date.now() - 60_000) }),
    )
    const html = renderToStaticMarkup(await ReprogramarPage({ params }))
    expect(html).toContain('Manicura')
    expect(html.toLowerCase()).not.toContain('venció el plazo')
  })
})

function dentroDeVentana(overrides: Record<string, unknown> = {}) {
  return {
    id: 'bk1',
    startDateTime: new Date(Date.now() + 72 * 3_600_000), // en 72h
    status: 'pending_payment',
    paymentStatus: 'unpaid',
    holdExpiresAt: null,
    cancellationCutoffHours: 24,
    cancellationPolicySnapshot: null,
    service: { name: 'Manicura' },
    business: { slug: 'salon-ana', name: 'Salón Ana', timezone: 'America/Santiago', selfServiceCutoffHours: 24, cancellationPolicy: null },
    ...overrides,
  }
}
