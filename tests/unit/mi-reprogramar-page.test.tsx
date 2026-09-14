import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { act } from 'react'
import { createRoot } from 'react-dom/client'

const { mockGetCurrentUser, mockBookingFindFirst, mockRedirect, mockNotFound, mockGetSlots, mockReschedule } = vi.hoisted(() => ({
  mockGetCurrentUser: vi.fn(),
  mockBookingFindFirst: vi.fn(),
  mockRedirect: vi.fn((path: string) => { throw new Error(`REDIRECT:${path}`) }),
  mockNotFound: vi.fn(() => { throw new Error('NOT_FOUND') }),
  mockGetSlots: vi.fn(),
  mockReschedule: vi.fn(),
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
  getMyRescheduleSlots: mockGetSlots,
  rescheduleMyBooking: mockReschedule,
}))

import ReprogramarPage from '@/app/mi/[slug]/reservas/[bookingId]/reprogramar/page'
import { ReprogramarForm } from '@/app/mi/[slug]/reservas/[bookingId]/reprogramar/reprogramar-form'

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
      business: { slug: 'salon-ana', name: 'Salón Ana', subdomain: 'salon-ana', logoUrl: null, category: 'beauty', brandColor: '#785A6F', visualStyle: 'balanced', timezone: 'America/Santiago', selfServiceCutoffHours: 24, cancellationPolicy: null },
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
    expect(html).toContain('data-business-theme')
    expect(html).toContain('Volver a mis negocios')
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

  it('moves focus to the result heading after a successful reschedule', async () => {
    mockGetSlots.mockResolvedValue({ ok: true, data: [{ start: '2026-09-15T13:00:00.000Z', end: '2026-09-15T14:00:00.000Z' }] })
    mockReschedule.mockResolvedValue({ ok: true, data: { ok: true } })
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    await act(async () => {
      root.render(<ReprogramarForm bookingId="bk1" slug="salon-ana" serviceName="Manicura" currentDate="2026-09-15" currentTime="09:00" timezone="America/Santiago" />)
      await Promise.resolve()
      await Promise.resolve()
    })
    await act(async () => Array.from(host.querySelectorAll('button')).find((button) => button.textContent?.includes(':'))?.click())
    await act(async () => { host.querySelector('form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await Promise.resolve() })
    const heading = host.querySelector('h2')
    expect(heading?.textContent).toBe('Reserva reprogramada')
    expect(document.activeElement).toBe(heading)
    await act(async () => root.unmount())
    host.remove()
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
    business: { slug: 'salon-ana', name: 'Salón Ana', subdomain: 'salon-ana', logoUrl: null, category: 'beauty', brandColor: '#785A6F', visualStyle: 'balanced', timezone: 'America/Santiago', selfServiceCutoffHours: 24, cancellationPolicy: null },
    ...overrides,
  }
}
