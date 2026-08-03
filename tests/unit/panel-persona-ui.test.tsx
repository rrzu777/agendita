import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

/**
 * La fila "Atiende" en las superficies del panel: la card móvil de Reservas y
 * las consultas que la alimentan. El contrato es el de siempre: con persona
 * aparece "Atiende: <nombre>", sin persona no aparece ni el label.
 *
 * Los include/select se assertan directo: con Prisma mockeado, mirar lo que se
 * renderiza no prueba que la consulta haya pedido la relación.
 */

const { mockFindMany, mockRequireBusiness } = vi.hoisted(() => ({
  mockFindMany: vi.fn().mockResolvedValue([]),
  mockRequireBusiness: vi.fn().mockResolvedValue({ businessId: 'b1' }),
}))

vi.mock('@/lib/db', () => ({ prisma: { booking: { findMany: mockFindMany } } }))
vi.mock('@/lib/auth/server', () => ({
  requireBusiness: mockRequireBusiness,
  requireBusinessRole: vi.fn(),
  requireBusinessAccess: vi.fn(),
  ForbiddenError: class ForbiddenError extends Error {},
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/navigation', () => ({
  redirect: vi.fn(),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}))

import { BookingCard } from '@/app/dashboard/bookings/page'
import { getBookings, getBookingsByRange } from '@/server/actions/bookings'

function makeBooking(professional: { name: string } | null) {
  return {
    id: 'bk-1',
    bookingNumber: 4738,
    startDateTime: new Date('2026-08-05T14:00:00Z'),
    status: 'confirmed',
    depositPaid: 0,
    depositRequired: 0,
    finalAmount: 10000,
    paymentStatus: 'none',
    totalPrice: 10000,
    remainingBalance: 10000,
    modality: 'on_site' as const,
    service: { name: 'Corte' },
    professional,
    customer: { name: 'Maria', phone: '+56911111111', email: null },
    holdExpiresAt: null,
    payments: [],
  }
}

describe('BookingCard (móvil) y la persona', () => {
  it('con persona muestra "Atiende:" con el nombre', () => {
    const html = renderToStaticMarkup(
      <BookingCard
        booking={makeBooking({ name: 'Juan Pérez' })}
        businessCurrency="CLP"
        businessTimezone="America/Santiago"
        businessAddress={null}
      />,
    )
    expect(html).toContain('Atiende:')
    expect(html).toContain('Juan Pérez')
  })

  it('sin persona no muestra ni el label', () => {
    const html = renderToStaticMarkup(
      <BookingCard
        booking={makeBooking(null)}
        businessCurrency="CLP"
        businessTimezone="America/Santiago"
        businessAddress={null}
      />,
    )
    expect(html).not.toContain('Atiende')
  })
})

describe('las consultas del panel piden a la persona', () => {
  beforeEach(() => {
    mockFindMany.mockClear()
  })

  it('getBookings (tabla de Reservas) la trae en el select', async () => {
    await getBookings()

    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({ professional: { select: { name: true } } }),
      }),
    )
  })

  it('getBookingsByRange (calendario) la trae en el include', async () => {
    await getBookingsByRange(new Date('2026-08-01T00:00:00Z'), new Date('2026-08-08T00:00:00Z'))

    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({ professional: { select: { name: true } } }),
      }),
    )
  })
})
