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

// Server-safe logical bounds. Client definitions validate their exact length
// against this map, while Server Actions can reject impossible progress without
// importing JSX or lazy component loaders.
export const TOUR_STEP_BOUNDS = {
  dashboard_intro: 5,
  bookings: 5,
  payments: 5,
  settings: 4,
} satisfies Record<TourKey, number>

export function roleCanUseAnyTour(role: string): boolean {
  return (Object.keys(TOUR_CATALOG) as TourKey[]).some((key) => (
    TOUR_CATALOG[key].roles.some((allowedRole) => allowedRole === role)
  ))
}

export type TourProgressEvent =
  | { type: 'offer' }
  | { type: 'start' }
  | { type: 'step'; step: number }
  | { type: 'complete' }
  | { type: 'dismiss' }
