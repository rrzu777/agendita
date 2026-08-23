'use client'

import { createContext, useContext } from 'react'
import type { TourKey } from '@/lib/tours/catalog'

export type DashboardTourHelpItem = {
  key: TourKey
  title: string
  status: 'available' | 'in_progress' | 'completed' | 'dismissed'
}

export type DashboardTourContextValue = {
  available: TourKey[]
  helpTours: DashboardTourHelpItem[]
  active: { key: TourKey; step: number } | null
  start(key: TourKey, options?: { replay?: boolean }): Promise<void>
  next(): Promise<void>
  previous(): void
  dismiss(key?: TourKey): Promise<void>
  offer(key: TourKey): Promise<void>
  closeReplay(): void
}

export const DashboardTourContext = createContext<DashboardTourContextValue | null>(null)

export function useDashboardTours(): DashboardTourContextValue {
  const context = useContext(DashboardTourContext)
  if (!context) {
    throw new Error('DashboardTourProvider is required to use dashboard tours')
  }
  return context
}
