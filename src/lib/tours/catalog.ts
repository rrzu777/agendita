export const TOUR_CATALOG = {
  dashboard_intro: {
    version: 1,
    route: '/dashboard',
    roles: ['owner', 'admin'],
    title: 'Primeros pasos en Agendita',
  },
  bookings: {
    version: 1,
    route: '/dashboard/bookings',
    roles: ['owner', 'admin'],
    title: 'Gestiona tus reservas',
  },
  payments: {
    version: 1,
    route: '/dashboard/payments',
    roles: ['owner', 'admin'],
    title: 'Revisa tus pagos',
  },
  settings: {
    version: 1,
    route: '/dashboard/settings/profile',
    roles: ['owner', 'admin'],
    title: 'Configura tu negocio',
  },
} as const

export type TourKey = keyof typeof TOUR_CATALOG

export type TourProgressEvent =
  | { type: 'offer' }
  | { type: 'start' }
  | { type: 'step'; step: number }
  | { type: 'complete' }
  | { type: 'dismiss' }
