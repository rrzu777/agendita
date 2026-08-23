import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { TOUR_TARGET_FILES } from '@/components/dashboard/tours/tour-definitions'

const contextualTargetIds = [
  'bookings-actions',
  'bookings-empty',
  'bookings-search',
  'bookings-status',
  'bookings-transfer',
  'payments-filters',
  'payments-history',
  'payments-history-empty',
  'payments-register',
  'payments-settings',
  'payments-stats',
  'settings-navigation',
  'settings-policies',
  'settings-preview',
  'settings-save',
] as const

describe('dashboard microtour targets', () => {
  it('declares each contextual target on its stable product surface', () => {
    for (const targetId of contextualTargetIds) {
      expect(TOUR_TARGET_FILES[targetId]).toBeDefined()
      for (const file of TOUR_TARGET_FILES[targetId] ?? []) {
        const source = readFileSync(resolve(process.cwd(), file), 'utf8')
        expect(source).toContain(`data-tour-id="${targetId}"`)
      }
    }
  })

  it('keeps data alternatives on the existing empty or search states', () => {
    expect(TOUR_TARGET_FILES['bookings-empty'])
      .toEqual(['src/app/dashboard/bookings/page.tsx'])
    expect(TOUR_TARGET_FILES['bookings-search'])
      .toEqual(['src/app/dashboard/bookings/page.tsx'])
    expect(TOUR_TARGET_FILES['payments-history-empty'])
      .toEqual(['src/components/dashboard/ledger-table.tsx'])
  })
})
