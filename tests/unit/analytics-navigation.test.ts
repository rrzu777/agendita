import { describe, expect, it } from 'vitest'
import { getDashboardNavItems } from '@/lib/dashboard/navigation'
import { getVocabulary } from '@/lib/vocabulary'

describe('analytics dashboard navigation', () => {
  it('shows Métricas to owners and admins, and places it under Más on mobile', () => {
    const vocabulary = getVocabulary('beauty')

    for (const role of ['owner', 'admin'] as const) {
      const metrics = getDashboardNavItems(vocabulary, role).find((item) => item.href === '/dashboard/metricas')

      expect(metrics).toMatchObject({ label: 'Métricas', mobile: 'more' })
    }
  })

  it('does not expose Métricas to staff', () => {
    const items = getDashboardNavItems(getVocabulary('beauty'), 'staff')

    expect(items.find((item) => item.href === '/dashboard/metricas')).toBeUndefined()
  })
})
