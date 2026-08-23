import { describe, expect, it } from 'vitest'
import { getAvailableTours } from '@/lib/tours/eligibility'

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

  it('honors an optional feature or data predicate', () => {
    expect(getAvailableTours({
      ...base,
      canOffer: () => false,
    })).toEqual([])
  })
})
