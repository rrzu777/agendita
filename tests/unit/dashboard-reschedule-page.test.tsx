import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

const { mockGetUser, mockBookingFindFirst, mockRedirect, mockNotFound } = vi.hoisted(() => ({
  mockGetUser: vi.fn(),
  mockBookingFindFirst: vi.fn(),
  mockRedirect: vi.fn((path: string) => { throw new Error(`REDIRECT:${path}`) }),
  mockNotFound: vi.fn(() => { throw new Error('NOT_FOUND') }),
}))

vi.mock('@/lib/auth/user', () => ({ getCurrentUserWithBusiness: mockGetUser }))
vi.mock('@/lib/db', () => ({ prisma: { booking: { findFirst: mockBookingFindFirst } } }))
vi.mock('next/navigation', () => ({
  redirect: mockRedirect,
  notFound: mockNotFound,
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}))
// El formulario es una isla de cliente con sus propias actions; acá se prueba
// QUIÉN llega hasta él, no lo que hace adentro.
vi.mock('@/app/dashboard/bookings/[id]/reschedule/reschedule-form', () => ({
  RescheduleForm: () => <form data-testid="reschedule-form" />,
}))

import ReschedulePage from '@/app/dashboard/bookings/[id]/reschedule/page'

const params = Promise.resolve({ id: 'bk1' })

function reservaViva(overrides: Record<string, unknown> = {}) {
  return {
    id: 'bk1',
    bookingNumber: 4738,
    startDateTime: new Date('2026-06-15T14:00:00Z'),
    status: 'pending_payment',
    paymentStatus: 'unpaid',
    holdExpiresAt: null,
    modality: 'in_person',
    serviceAddress: null,
    meetingUrl: null,
    service: { name: 'Manicura', durationMinutes: 60 },
    customer: { name: 'Ana', phone: '+56911111111' },
    professional: null,
    ...overrides,
  }
}

describe('/dashboard/bookings/[id]/reschedule', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetUser.mockResolvedValue({
      user: { id: 'u1' },
      business: { id: 'biz1', timezone: 'America/Santiago', addressText: null },
    })
  })

  it('estado terminal → vuelve a la lista', async () => {
    mockBookingFindFirst.mockResolvedValue(reservaViva({ status: 'cancelled' }))
    await expect(ReschedulePage({ params })).rejects.toThrow('REDIRECT:/dashboard/bookings')
  })

  // El drawer ya esconde el botón, pero acá se llega por URL directa, por un
  // marcador o con el botón Atrás. Sin el corte la dueña recorría el selector
  // entero para que el "no" apareciera recién al enviar.
  it('plazo vencido → explica el motivo, sin formulario', async () => {
    mockBookingFindFirst.mockResolvedValue(
      reservaViva({ holdExpiresAt: new Date(Date.now() - 60_000) }),
    )
    const html = renderToStaticMarkup(await ReschedulePage({ params }))
    expect(html.toLowerCase()).toContain('venció el plazo')
    // Nombra la salida: un "no" sin salida es indistinguible de una app rota.
    expect(html).toContain('Revivir')
    expect(html).not.toContain('reschedule-form')
    // Y no es un redirect mudo: ahí el motivo se pierde y la reserva se ve viva.
    expect(mockRedirect).not.toHaveBeenCalled()
  })

  // Con plata adentro el cron no barre nada: el plazo vencido no condena a esta
  // reserva y el formulario tiene que seguir apareciendo.
  it('plazo vencido con abono pagado → sigue el formulario', async () => {
    mockBookingFindFirst.mockResolvedValue(
      reservaViva({ paymentStatus: 'deposit_paid', holdExpiresAt: new Date(Date.now() - 60_000) }),
    )
    const html = renderToStaticMarkup(await ReschedulePage({ params }))
    expect(html).toContain('reschedule-form')
  })

  it('reserva viva → formulario', async () => {
    mockBookingFindFirst.mockResolvedValue(reservaViva())
    const html = renderToStaticMarkup(await ReschedulePage({ params }))
    expect(html).toContain('reschedule-form')
  })
})
