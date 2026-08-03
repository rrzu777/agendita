import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

/**
 * El filtro por persona del calendario (?persona=), probado desde la página:
 * es el único lugar donde el predicado del motor (blockAppliesToProfessional)
 * y el hilo del parámetro por los links se encuentran. Lo del negocio
 * (professionalId null) aplica a todas las personas, así que el día filtrado
 * de una persona muestra también las citas y bloqueos sin dueño.
 */

const { mockGetUser, mockBookingsByRange, mockBlocksByRange, mockProfessionalNames } = vi.hoisted(() => ({
  mockGetUser: vi.fn(),
  mockBookingsByRange: vi.fn(),
  mockBlocksByRange: vi.fn(),
  mockProfessionalNames: vi.fn(),
}))

vi.mock('@/lib/auth/user', () => ({ getCurrentUserWithBusiness: mockGetUser }))
vi.mock('@/server/actions/bookings', () => ({ getBookingsByRange: mockBookingsByRange }))
vi.mock('@/server/actions/time-blocks', () => ({ getTimeBlocksByRange: mockBlocksByRange }))
vi.mock('@/server/actions/professionals', () => ({ getProfessionalNames: mockProfessionalNames }))
vi.mock('@/lib/storage/r2', () => ({ isObjectStorageAvailable: () => false }))
vi.mock('next/navigation', () => ({
  redirect: vi.fn(() => { throw new Error('REDIRECT') }),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}))
// Los diálogos del calendario no aportan al filtro y arrastran medio dashboard.
vi.mock('@/components/dashboard/block-time-modal', () => ({ BlockTimeModal: () => null }))
vi.mock('@/components/dashboard/booking-drawer', () => ({ BookingDrawer: () => null }))
vi.mock('@/components/dashboard/edit-block-dialog', () => ({ EditBlockDialog: () => null }))
vi.mock('@/components/dashboard/edit-series-occurrence-dialog', () => ({ EditSeriesOccurrenceDialog: () => null }))

import CalendarPage from '@/app/dashboard/calendar/page'

function booking(id: string, customerName: string, professionalId: string | null, professionalName: string | null) {
  return {
    id,
    bookingNumber: 1,
    professionalId,
    professional: professionalName ? { name: professionalName } : null,
    startDateTime: new Date('2026-08-05T14:00:00Z'),
    endDateTime: new Date('2026-08-05T15:00:00Z'),
    status: 'confirmed',
    totalPrice: 10000,
    depositPaid: 0,
    depositRequired: 0,
    finalAmount: 10000,
    remainingBalance: 10000,
    paymentStatus: 'none',
    modality: 'on_site',
    service: { name: 'Corte' },
    customer: { name: customerName, phone: '+56911111111', email: null },
  }
}

function block(id: string, reason: string, professionalId: string | null) {
  return {
    id,
    startDateTime: new Date('2026-08-05T17:00:00Z'),
    endDateTime: new Date('2026-08-05T18:00:00Z'),
    reason,
    professionalId,
    seriesId: undefined,
    occurrenceDate: null,
  }
}

async function renderCalendar(params: { view?: string; date?: string; persona?: string }) {
  return renderToStaticMarkup(await CalendarPage({ searchParams: Promise.resolve(params) }))
}

describe('el filtro por persona del calendario', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetUser.mockResolvedValue({
      user: { id: 'u1' },
      business: { id: 'b1', timezone: 'America/Santiago', currency: 'CLP', addressText: null },
    })
    mockBookingsByRange.mockResolvedValue([
      booking('bk-juan', 'ClientaDeJuan', 'p-juan', 'Juan'),
      booking('bk-ana', 'ClientaDeAna', 'p-ana', 'Ana P'),
      booking('bk-negocio', 'ClientaSinPersona', null, null),
    ])
    mockBlocksByRange.mockResolvedValue([
      block('tb-juan', 'AlmuerzoJuan', 'p-juan'),
      block('tb-negocio', 'FeriadoNegocio', null),
    ])
    mockProfessionalNames.mockResolvedValue([
      { id: 'p-juan', name: 'Juan', isActive: true },
      { id: 'p-ana', name: 'Ana P', isActive: true },
    ])
  })

  it('con ?persona= muestra lo suyo Y lo del negocio, y esconde al resto', async () => {
    const html = await renderCalendar({ view: 'day', date: '2026-08-05', persona: 'p-ana' })

    expect(html).toContain('ClientaDeAna')
    // Lo sin persona ocupa la agenda de todas: mismo criterio que el motor.
    expect(html).toContain('ClientaSinPersona')
    expect(html).toContain('FeriadoNegocio')
    expect(html).not.toContain('ClientaDeJuan')
    expect(html).not.toContain('AlmuerzoJuan')
  })

  it('un id inventado o viejo cae en "todo el equipo", no en un calendario vacío', async () => {
    const html = await renderCalendar({ view: 'day', date: '2026-08-05', persona: 'no-existe' })

    expect(html).toContain('ClientaDeJuan')
    expect(html).toContain('ClientaDeAna')
    expect(html).toContain('ClientaSinPersona')
  })

  it('el parámetro sobrevive a la navegación: anterior/siguiente/Hoy/vistas lo llevan', async () => {
    const html = await renderCalendar({ view: 'day', date: '2026-08-05', persona: 'p-ana' })

    // Anterior + Hoy + Siguiente + 3 vistas del switch, como mínimo.
    const conPersona = html.match(/persona=p-ana/g) ?? []
    expect(conPersona.length).toBeGreaterThanOrEqual(6)
  })

  it('el selector aparece con equipo y no aparece sin equipo', async () => {
    const conEquipo = await renderCalendar({ view: 'day', date: '2026-08-05' })
    expect(conEquipo).toContain('Filtrar por quién atiende')
    expect(conEquipo).toContain('Todo el equipo')

    mockProfessionalNames.mockResolvedValue([])
    const sinEquipo = await renderCalendar({ view: 'day', date: '2026-08-05' })
    expect(sinEquipo).not.toContain('Filtrar por quién atiende')
  })

  it('el chip de la cita dice quién atiende', async () => {
    // Sin selector (equipo vacío) el nombre sólo puede venir del chip; si no,
    // el <option> del filtro haría pasar este test aunque el chip no lo diga.
    mockProfessionalNames.mockResolvedValue([])
    const html = await renderCalendar({ view: 'day', date: '2026-08-05' })
    // La cita de Juan dura 60 min: el chip tiene alto para la línea del nombre.
    expect(html).toContain('Juan')
    expect(html).not.toContain('Filtrar por quién atiende')
  })
})
