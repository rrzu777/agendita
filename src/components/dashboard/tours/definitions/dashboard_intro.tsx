import { TOUR_CATALOG } from '@/lib/tours/catalog'
import type { TourDefinition } from '@/components/dashboard/tours/tour-types'

const tour = TOUR_CATALOG.dashboard_intro

export const definition = {
  key: 'dashboard_intro',
  version: tour.version,
  route: tour.route,
  roles: tour.roles,
  title: tour.title,
  steps: [
    {
      id: 'checklist',
      targetKind: 'static',
      targetId: 'dashboard-checklist',
      title: 'Tu mapa de preparación',
      body: 'Este checklist refleja la configuración y los resultados reales que faltan para operar.',
      viewports: ['mobile', 'desktop'],
      waitMs: 300,
    },
    {
      id: 'desktop-navigation',
      targetKind: 'static',
      targetId: 'nav-desktop',
      title: 'Navega por tu negocio',
      body: 'Encuentra aquí las secciones para administrar tu agenda.',
      viewports: ['desktop'],
      waitMs: 300,
    },
    {
      id: 'mobile-navigation',
      targetKind: 'static',
      targetId: 'nav-mobile-more',
      title: 'Más secciones en tu teléfono',
      body: 'Abre Más para acceder a todas las secciones adicionales.',
      viewports: ['mobile'],
      waitMs: 300,
    },
    {
      id: 'new-booking',
      targetKind: 'static',
      targetId: 'dashboard-new-booking',
      title: 'Crea una reserva',
      body: 'Nueva reserva te lleva al formulario manual; el recorrido nunca lo abre por su cuenta.',
      viewports: ['mobile', 'desktop'],
      waitMs: 300,
    },
    {
      id: 'help',
      targetKind: 'static',
      targetId: 'tour-help',
      title: 'Vuelve cuando lo necesites',
      body: 'Desde Ayuda y recorridos puedes repetir la orientación disponible en esta sección.',
      viewports: ['mobile', 'desktop'],
      waitMs: 300,
    },
  ],
} satisfies TourDefinition
