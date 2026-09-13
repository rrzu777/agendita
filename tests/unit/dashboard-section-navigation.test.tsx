import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { getVocabulary } from '@/lib/vocabulary'
import { DashboardSectionNav } from '@/components/dashboard/dashboard-section-nav'

const { mockPathname } = vi.hoisted(() => ({ mockPathname: vi.fn() }))

vi.mock('next/navigation', () => ({ usePathname: mockPathname }))
vi.mock('@/components/dashboard/unsaved-changes-provider', () => ({
  GuardedLink: ({ href, children, ...props }: React.ComponentProps<'a'> & { href: string }) => (
    <a href={href} {...props}>{children}</a>
  ),
}))

describe('DashboardSectionNav', () => {
  it('exposes every growth route and keeps campaigns current on campaign detail', () => {
    mockPathname.mockReturnValue('/dashboard/campanas/campaign-1')
    const html = renderToStaticMarkup(
      <DashboardSectionNav section="growth" vocabulary={getVocabulary('other')} role="owner" />,
    )

    expect(html).toContain('aria-label="Crecimiento"')
    for (const label of ['Métricas', 'Promociones', 'Fidelización', 'Campañas', 'Paquetes', 'Reseñas']) {
      expect(html).toContain(`>${label}<`)
    }
    expect(html).toMatch(/href="\/dashboard\/campanas"[^>]*aria-current="page"/)
  })

  it('hides owner-only metrics for staff while preserving the remaining growth workflows', () => {
    mockPathname.mockReturnValue('/dashboard/promociones')
    const html = renderToStaticMarkup(
      <DashboardSectionNav section="growth" vocabulary={getVocabulary('other')} role="staff" />,
    )

    expect(html).not.toContain('>Métricas<')
    expect(html).toContain('>Promociones<')
    expect(html).toContain('aria-current="page"')
  })

  it('exposes the complete finance route group with one current route', () => {
    mockPathname.mockReturnValue('/dashboard/billing')
    const html = renderToStaticMarkup(
      <DashboardSectionNav section="finance" vocabulary={getVocabulary('other')} role="owner" />,
    )

    expect(html).toContain('aria-label="Finanzas"')
    expect(html).toContain('>Cobros<')
    expect(html).toContain('>Plan y facturación<')
    expect(html.match(/aria-current="page"/g)).toHaveLength(1)
  })
})
