import { describe, expect, it } from 'vitest'
import { getAvailableTours } from '@/lib/tours/eligibility'
import { TOUR_CATALOG, type TourKey } from '@/lib/tours/catalog'
import { getLoadableTourKeys } from '@/components/dashboard/tours/tour-definitions'

const base = {
  role: 'owner',
  pathname: '/dashboard',
  onboardingCompleted: true,
  viewport: 'desktop',
  progress: [],
  toursEnabled: true,
} as const

describe('getAvailableTours', () => {
  it('offers the dashboard introduction to an eligible owner', () => {
    expect(getAvailableTours(base).map((tour) => tour.key)).toContain('dashboard_intro')
  })

  it.each([
    ['staff role', { role: 'staff' }],
    ['incomplete onboarding', { onboardingCompleted: false }],
    ['disabled rollout', { toursEnabled: false }],
    ['unsupported viewport', { viewport: 'tablet' }],
  ] as const)('excludes the introduction for %s', (_reason, override) => {
    expect(getAvailableTours({ ...base, ...override })).toEqual([])
  })

  it('excludes the introduction away from its route', () => {
    expect(getAvailableTours({ ...base, pathname: '/dashboard/bookings' }))
      .not.toContainEqual(expect.objectContaining({ key: 'dashboard_intro' }))
  })

  it('offers exactly the tours with a loadable definition', () => {
    const offeredKeys = (Object.keys(TOUR_CATALOG) as TourKey[]).flatMap((key) => (
      getAvailableTours({ ...base, pathname: TOUR_CATALOG[key].route }).map((tour) => tour.key)
    ))

    expect(offeredKeys).toEqual(getLoadableTourKeys())
  })

  it('excludes a terminal snapshot for the current version', () => {
    expect(getAvailableTours({
      ...base,
      progress: [{ key: 'dashboard_intro', version: 1, status: 'dismissed', lastStep: 0 }],
    })).toEqual([])
  })

  it('keeps in-progress state resumable at its persisted step', () => {
    expect(getAvailableTours({
      ...base,
      progress: [{ key: 'dashboard_intro', version: 1, status: 'in_progress', lastStep: 1 }],
    })).toEqual([expect.objectContaining({ key: 'dashboard_intro', resumeStep: 1 })])
  })

  it('clamps oversized in-progress snapshots to the definition bound', () => {
    expect(getAvailableTours({
      ...base,
      progress: [{ key: 'dashboard_intro', version: 1, status: 'in_progress', lastStep: 99 }],
    })).toEqual([expect.objectContaining({ key: 'dashboard_intro', resumeStep: 4 })])
  })

  it('honors an optional feature or data predicate', () => {
    expect(getAvailableTours({
      ...base,
      canOffer: () => false,
    })).toEqual([])
  })
})
