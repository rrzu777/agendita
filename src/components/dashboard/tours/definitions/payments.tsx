import { TOUR_CATALOG } from '@/lib/tours/catalog'
import type { TourDefinition } from '@/components/dashboard/tours/tour-types'

const tour = TOUR_CATALOG.payments

export const definition = {
  key: 'payments',
  version: tour.version,
  route: tour.route,
  roles: tour.roles,
  title: tour.title,
  steps: [
    {
      id: 'stats',
      targetKind: 'static',
      targetId: 'payments-stats',
      title: 'Revisa tus indicadores',
      body: 'Estos montos resumen ingresos, abonos, pendientes y reembolsos.',
      viewports: ['mobile', 'desktop'],
      waitMs: 300,
    },
    {
      id: 'register',
      targetKind: 'static',
      targetId: 'payments-register',
      title: 'Registra un pago',
      body: 'Registra cobros manuales sobre reservas con saldo pendiente.',
      viewports: ['mobile', 'desktop'],
      waitMs: 300,
    },
    {
      id: 'filters',
      targetKind: 'static',
      targetId: 'payments-filters',
      title: 'Filtra por fechas',
      body: 'Elige un rango para exportar los movimientos que necesitas revisar.',
      viewports: ['mobile', 'desktop'],
      waitMs: 300,
    },
    {
      id: 'history',
      targetKind: 'data',
      targetId: 'payments-history',
      fallbackTargetId: 'payments-history-empty',
      title: 'Consulta el historial',
      body: 'Aquí quedan registrados ingresos, abonos y ajustes.',
      viewports: ['mobile', 'desktop'],
      waitMs: 300,
    },
    {
      id: 'settings',
      targetKind: 'static',
      targetId: 'payments-settings',
      title: 'Configura medios de pago',
      body: 'Configuración reúne las opciones de cobro de tu negocio.',
      viewports: ['desktop'],
      waitMs: 300,
    },
  ],
} satisfies TourDefinition
