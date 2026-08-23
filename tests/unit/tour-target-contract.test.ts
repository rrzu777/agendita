import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  TOUR_TARGET_FILES,
  assertTourDefinitionContract,
  assertTourTargetManifestContract,
} from '@/components/dashboard/tours/tour-definitions'

describe('tour target contract', () => {
  it('keeps the exact unique target set required by dashboard tours', () => {
    expect(Object.keys(TOUR_TARGET_FILES).sort()).toEqual([
      'bookings-actions',
      'bookings-empty',
      'bookings-new',
      'bookings-search',
      'bookings-status',
      'bookings-transfer',
      'dashboard-checklist',
      'dashboard-new-booking',
      'nav-desktop',
      'nav-mobile-more',
      'payments-filters',
      'payments-history',
      'payments-history-empty',
      'payments-register',
      'payments-settings',
      'payments-stats',
      'settings-navigation',
      'settings-preview',
      'settings-save',
      'tour-help',
    ])
    expect(new Set(Object.keys(TOUR_TARGET_FILES)).size)
      .toBe(Object.keys(TOUR_TARGET_FILES).length)
  })

  it('keeps every declared product surface path resolvable', () => {
    for (const [targetId, files] of Object.entries(TOUR_TARGET_FILES)) {
      for (const file of files) {
        expect(existsSync(resolve(process.cwd(), file)), targetId).toBe(true)
      }
    }
  })

  it('binds every manifest target to an exact data-tour-id attribute in product markup', () => {
    for (const [targetId, files] of Object.entries(TOUR_TARGET_FILES)) {
      const escapedTarget = targetId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const directAttribute = new RegExp(`data-tour-id\\s*=\\s*["']${escapedTarget}["']`)
      const exactExpression = new RegExp(
        `data-tour-id\\s*=\\s*\\{[^}\\n]*["']${escapedTarget}["'][^}\\n]*\\}`,
      )
      const declared = files.some((file) => {
        const source = readFileSync(resolve(process.cwd(), file), 'utf8')
        return directAttribute.test(source) || exactExpression.test(source)
      })

      expect(declared, `${targetId} must be attached to actual product markup`).toBe(true)
    }
  })

  it('rejects empty role or viewport sets and data steps without fallbacks', () => {
    const invalidDefinition = {
      key: 'dashboard_intro',
      version: 1,
      route: '/dashboard',
      roles: [],
      title: 'Introducción',
      steps: [{
        id: 'data-dependent',
        targetKind: 'data',
        targetId: 'booking-row',
        title: 'Reserva',
        body: 'Revisa esta reserva.',
        viewports: [],
        waitMs: 100,
      }],
    }

    expect(() => assertTourDefinitionContract(invalidDefinition as never)).toThrow('roles')

    expect(() => assertTourDefinitionContract({
      ...invalidDefinition,
      roles: ['owner', 'admin'],
    } as never)).toThrow('viewports')

    expect(() => assertTourDefinitionContract({
      ...invalidDefinition,
      roles: ['owner', 'admin'],
      steps: [{ ...invalidDefinition.steps[0], viewports: ['desktop'] }],
    } as never)).toThrow('fallback')
  })

  it('rejects static steps that bypass the target manifest', () => {
    expect(() => assertTourDefinitionContract({
      key: 'dashboard_intro',
      version: 1,
      route: '/dashboard',
      roles: ['owner', 'admin'],
      title: 'Introducción',
      steps: [{
        id: 'untracked-target',
        targetKind: 'static',
        targetId: 'unstable-class-selector',
        title: 'Inestable',
        body: 'No debe depender de selectores frágiles.',
        viewports: ['desktop'],
        waitMs: 100,
      }],
    })).toThrow('target manifest')
  })

  it('rejects a target-manifest entry with no product files', () => {
    expect(() => assertTourTargetManifestContract({ 'nav-desktop': [] }))
      .toThrow('at least one product file')
    expect(() => assertTourTargetManifestContract({ 'nav-desktop': [''] }))
      .toThrow('non-empty')
  })
})
