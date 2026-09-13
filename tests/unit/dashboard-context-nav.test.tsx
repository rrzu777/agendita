import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { UnsavedChangesProvider } from '@/components/dashboard/unsaved-changes-provider'
import { DashboardContextNav } from '@/components/dashboard/dashboard-context-nav'

vi.mock('next/navigation', () => ({
  usePathname: () => '/dashboard/services',
  useRouter: () => ({ push: vi.fn() }),
}))

describe('DashboardContextNav', () => {
  it('renders route-backed links and identifies the current secondary destination', () => {
    const html = renderToStaticMarkup(
      <UnsavedChangesProvider>
        <DashboardContextNav
          label="Catálogo"
          items={[
            { href: '/dashboard/services', label: 'Servicios' },
            { href: '/dashboard/equipo', label: 'Equipo' },
          ]}
        />
      </UnsavedChangesProvider>,
    )

    expect(html).toContain('aria-label="Catálogo"')
    expect(html).toMatch(/<a[^>]*aria-current="page"[^>]*href="\/dashboard\/services"/)
    expect(html).toContain('href="/dashboard/equipo"')
  })
})
