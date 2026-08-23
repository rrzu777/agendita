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
      title: 'Más secciones',
      body: 'Abre Más para acceder a las secciones adicionales.',
      viewports: ['mobile'],
      waitMs: 300,
    },
  ],
} satisfies TourDefinition
