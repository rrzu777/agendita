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
      fallbackTargetId: 'bookings-search',
      title: 'Revisa transferencias',
      body: 'Las transferencias declaradas se verifican desde esta sección.',
      viewports: ['mobile', 'desktop'],
      waitMs: 300,
    },
    {
      id: 'status',
      targetKind: 'data',
      targetId: 'bookings-status',
      fallbackTargetId: 'bookings-search',
      title: 'Consulta el estado y saldo',
      body: 'Cada reserva muestra su estado de atención y de pago.',
      viewports: ['mobile', 'desktop'],
      waitMs: 300,
    },
    {
      id: 'actions',
      targetKind: 'data',
      targetId: 'bookings-actions',
      fallbackTargetId: 'bookings-search',
      title: 'Gestiona la reserva',
      body: 'Usa las acciones disponibles para completar, cobrar o reprogramar.',
      viewports: ['mobile', 'desktop'],
      waitMs: 300,
    },
  ],
} satisfies TourDefinition
