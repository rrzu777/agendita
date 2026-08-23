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

  it('rejects duplicate step identifiers', () => {
    expect(() => assertTourDefinitionContract({
      key: 'dashboard_intro',
      version: 1,
      route: '/dashboard',
      roles: ['owner'],
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
})
