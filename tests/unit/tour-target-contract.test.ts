import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  TOUR_TARGET_FILES,
  assertTourDefinitionContract,
  assertTourTargetManifestContract,
} from '@/components/dashboard/tours/tour-definitions'

describe('tour target contract', () => {
  it('keeps every declared static target on its declared product surface', () => {
    for (const [targetId, files] of Object.entries(TOUR_TARGET_FILES)) {
      for (const file of files) {
        const source = readFileSync(resolve(process.cwd(), file), 'utf8')
        expect(source).toContain(`data-tour-id="${targetId}"`)
      }
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
