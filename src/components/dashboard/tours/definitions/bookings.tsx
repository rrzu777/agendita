import { TOUR_CATALOG } from '@/lib/tours/catalog'
import type { TourDefinition } from '@/components/dashboard/tours/tour-types'

const tour = TOUR_CATALOG.bookings

export const definition = {
  key: 'bookings',
  version: tour.version,
  route: tour.route,
  roles: tour.roles,
  title: tour.title,
  steps: [
    {
      id: 'new-booking',
      targetKind: 'static',
      targetId: 'bookings-new',
      title: 'Crea una reserva',
      body: 'Nueva reserva abre el formulario para agendar una cita.',
      viewports: ['mobile', 'desktop'],
      waitMs: 300,
    },
    {
      id: 'search',
      targetKind: 'static',
      targetId: 'bookings-search',
      title: 'Busca una reserva',
      body: 'Encuentra una reserva usando su número.',
      viewports: ['mobile', 'desktop'],
      waitMs: 300,
    },
    {
      id: 'transfer',
      targetKind: 'data',
      targetId: 'bookings-transfer',
      fallbackTargetId: 'bookings-empty',
      title: 'Aquí verás transferencias por revisar',
      body: 'Cuando un cliente declare una transferencia, aparecerá en Reservas para verificarla.',
      viewports: ['mobile', 'desktop'],
      waitMs: 300,
    },
    {
      id: 'status',
      targetKind: 'data',
      targetId: 'bookings-status',
      fallbackTargetId: 'bookings-empty',
      title: 'Aquí verás el estado y saldo',
      body: 'Cuando tengas reservas, verás su estado de atención y de pago en esta pantalla.',
      viewports: ['mobile', 'desktop'],
      waitMs: 300,
    },
    {
      id: 'actions',
      targetKind: 'data',
      targetId: 'bookings-actions',
      fallbackTargetId: 'bookings-empty',
      title: 'Aquí gestionarás cada reserva',
      body: 'Cuando tengas reservas, podrás completarlas, cobrarlas o reprogramarlas desde sus acciones.',
      viewports: ['mobile', 'desktop'],
      waitMs: 300,
    },
  ],
} satisfies TourDefinition
