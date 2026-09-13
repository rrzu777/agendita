import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { DashboardCatalogueNav } from '@/components/dashboard/dashboard-catalogue-nav'
import { UnsavedChangesProvider } from '@/components/dashboard/unsaved-changes-provider'
import { getVocabulary } from '@/lib/vocabulary'

vi.mock('next/navigation', () => ({ usePathname: () => '/dashboard/availability', useRouter: () => ({ push: vi.fn() }) }))

describe('catalogue navigation', () => {
  it.each(['owner', 'admin', 'staff'] as const)('preserves the canonical catalogue links for %s', (role) => {
    const html = renderToStaticMarkup(<UnsavedChangesProvider><DashboardCatalogueNav vocabulary={getVocabulary('other')} role={role} /></UnsavedChangesProvider>)
    const document = new DOMParser().parseFromString(html, 'text/html')
    expect(document.querySelector('nav')?.getAttribute('aria-label')).toBe('Catálogo')
    expect([...document.querySelectorAll('a')].map((link) => link.getAttribute('href'))).toEqual(['/dashboard/services', '/dashboard/equipo', '/dashboard/availability'])
    expect(document.querySelector('[aria-current="page"]')?.textContent).toBe('Disponibilidad')
    expect(document.querySelector('[role="tablist"]')).toBeNull()
  })
})
