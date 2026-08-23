import { describe, expect, it } from 'vitest'
import {
  assertTourDefinitionContract,
  loadTourDefinition,
} from '@/components/dashboard/tours/tour-definitions'

describe('dashboard tour definitions', () => {
  it('lazy-loads the versioned introduction with viewport-specific navigation steps', async () => {
    await expect(loadTourDefinition('dashboard_intro')).resolves.toMatchObject({
      key: 'dashboard_intro',
      version: 1,
      route: '/dashboard',
      roles: ['owner', 'admin'],
      steps: [
        expect.objectContaining({ targetId: 'nav-desktop', viewports: ['desktop'] }),
        expect.objectContaining({ targetId: 'nav-mobile-more', viewports: ['mobile'] }),
      ],
    })
  })

  it('lazy-loads contextual tours with bounded data alternatives', async () => {
    const [bookings, payments, settings] = await Promise.all([
      loadTourDefinition('bookings'),
      loadTourDefinition('payments'),
      loadTourDefinition('settings'),
    ])

    expect(bookings.steps.find((step) => step.id === 'status')).toMatchObject({
      targetId: 'bookings-status',
      fallbackTargetId: 'bookings-search',
    })
    expect(bookings.steps.find((step) => step.id === 'transfer')).toMatchObject({
      targetId: 'bookings-transfer',
      fallbackTargetId: 'bookings-search',
    })
    expect(payments.steps.map((step) => step.targetId)).toEqual(expect.arrayContaining([
      'payments-stats',
      'payments-register',
      'payments-filters',
      'payments-history',
      'payments-settings',
    ]))
    expect(payments.steps.find((step) => step.id === 'history')?.viewports)
      .toEqual(['mobile', 'desktop'])
    expect(settings.steps.map((step) => step.targetId)).toEqual(expect.arrayContaining([
      'settings-navigation',
      'settings-preview',
      'settings-save',
    ]))
    expect(settings.steps.find((step) => step.id === 'policies')).toMatchObject({
      targetId: 'settings-navigation',
      body: expect.stringContaining('Políticas y avisos'),
    })
    expect(settings.steps.some((step) => step.targetId === 'settings-policies')).toBe(false)

    for (const definition of [bookings, payments, settings]) {
      expect(definition.steps.length).toBeLessThanOrEqual(5)
    }
    expect(bookings.steps.find((step) => step.id === 'actions')).toMatchObject({
      fallbackTargetId: 'bookings-search',
    })
  })

  it('rejects duplicate step identifiers', () => {
    expect(() => assertTourDefinitionContract({
      key: 'dashboard_intro',
      version: 1,
      route: '/dashboard',
      roles: ['owner', 'admin'],
      title: 'Introducción',
      steps: [
        {
          id: 'navigation',
          targetKind: 'static',
          targetId: 'nav-desktop',
          title: 'Navegación',
          body: 'Encuentra tus secciones aquí.',
          viewports: ['desktop'],
          waitMs: 100,
        },
        {
          id: 'navigation',
          targetKind: 'static',
          targetId: 'nav-mobile-more',
          title: 'Más',
          body: 'Abre las secciones adicionales.',
          viewports: ['mobile'],
          waitMs: 100,
        },
      ],
    })).toThrow('duplicate step id')
  })

  it('rejects a definition that omits a catalog-authorized role', () => {
    expect(() => assertTourDefinitionContract({
      key: 'dashboard_intro',
      version: 1,
      route: '/dashboard',
      roles: ['owner'],
      title: 'Introducción',
      steps: [],
    })).toThrow('exactly match')
  })
})
