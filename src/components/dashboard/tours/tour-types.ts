import type { BusinessRole } from '@prisma/client'
import type { TourKey } from '@/lib/tours/catalog'

export type TourViewport = 'mobile' | 'desktop'

type TourStepContent = {
  id: string
  title: string
  body: string
  viewports: readonly TourViewport[]
  waitMs: number
}

type StaticTourTarget = {
  targetKind: 'static'
  targetId: string
  fallbackTargetId?: never
}

type DataDependentTourTarget = {
  targetKind: 'data'
  targetId: string
  fallbackTargetId: string
}

export type TourStep = TourStepContent & (StaticTourTarget | DataDependentTourTarget)

export type TourDefinition = {
  key: TourKey
  version: number
  route: string
  roles: readonly BusinessRole[]
  title: string
  steps: readonly TourStep[]
}
