import type { BusinessRole } from '@prisma/client'
import type { TourProgressSnapshot } from '@/server/actions/tour-progress'
import { TOUR_CATALOG, type TourKey } from './catalog'

const SUPPORTED_VIEWPORTS = new Set(['mobile', 'desktop'])

export type AvailableTour = {
  key: TourKey
  version: number
  route: string
  roles: readonly BusinessRole[]
  resumeStep: number
}

export type TourEligibilityContext = {
  role: BusinessRole | string
  pathname: string
  onboardingCompleted: boolean
  viewport: string
  progress: readonly TourProgressSnapshot[]
  toursEnabled: boolean
  canOffer?: (tour: AvailableTour) => boolean
}

export function getAvailableTours(context: TourEligibilityContext): AvailableTour[] {
  if (!context.toursEnabled || !context.onboardingCompleted || !SUPPORTED_VIEWPORTS.has(context.viewport)) {
    return []
  }

  return (Object.keys(TOUR_CATALOG) as TourKey[]).flatMap((key) => {
    const catalog = TOUR_CATALOG[key]
    if (catalog.route !== context.pathname || !catalog.roles.some((role) => role === context.role)) {
      return []
    }

    const snapshot = context.progress.find((item) => item.key === key && item.version === catalog.version)
    if (snapshot?.status === 'completed' || snapshot?.status === 'dismissed') {
      return []
    }

    const tour: AvailableTour = {
      key,
      version: catalog.version,
      route: catalog.route,
      roles: catalog.roles,
      resumeStep: snapshot?.status === 'in_progress' ? Math.max(0, snapshot.lastStep) : 0,
    }

    return context.canOffer?.(tour) === false ? [] : [tour]
  })
}
