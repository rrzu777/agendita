import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type * as React from 'react'
import { SettingsFormSection } from '@/components/dashboard/settings/settings-form-section'
import { SettingsNavigation } from '@/components/dashboard/settings/settings-navigation'
import { SettingsSaveBar } from '@/components/dashboard/settings/settings-save-bar'
import { SettingsShell } from '@/components/dashboard/settings/settings-shell'

const { mockPathname } = vi.hoisted(() => ({ mockPathname: vi.fn() }))

vi.mock('next/navigation', () => ({ usePathname: mockPathname }))
vi.mock('@/components/dashboard/unsaved-changes-provider', () => ({
  GuardedLink: ({ href, prefetch, children, ...props }: React.ComponentProps<'a'> & { href: string; prefetch?: boolean }) => (
    <a href={href} data-prefetch={String(prefetch)} {...props}>{children}</a>
  ),
}))

describe('settings shell', () => {
  it('renders one accessible current section and disables payment prefetch', () => {
    mockPathname.mockReturnValue('/dashboard/settings/policies')

    const html = renderToStaticMarkup(<SettingsNavigation />)

    expect(html).toContain('aria-current="page"')
    expect(html.match(/aria-current="page"/g)).toHaveLength(1)
    expect(html).toContain('href="/dashboard/settings/policies"')
    expect(html).toContain('href="/dashboard/settings/payments" data-prefetch="false"')
  })

  it('marks a section current only for its exact registered route', () => {
    mockPathname.mockReturnValue('/dashboard/settings/profile')
    expect(renderToStaticMarkup(<SettingsNavigation />)).toMatch(/href="\/dashboard\/settings\/profile"[^>]*aria-current="page"/)

    mockPathname.mockReturnValue('/dashboard/settings')
    expect(renderToStaticMarkup(<SettingsNavigation />)).not.toContain('aria-current="page"')

    mockPathname.mockReturnValue('/dashboard/settings/not-found')
    expect(renderToStaticMarkup(<SettingsNavigation />)).not.toContain('aria-current="page"')
  })

  it('names every save state without relying on color', () => {
    const idle = renderToStaticMarkup(<SettingsSaveBar isDirty={false} isSubmitting={false} status="idle" />)
    const submitting = renderToStaticMarkup(<SettingsSaveBar isDirty isSubmitting status="idle" />)
    const saved = renderToStaticMarkup(<SettingsSaveBar isDirty={false} isSubmitting={false} status="saved" />)
    const dirtyAfterSaved = renderToStaticMarkup(<SettingsSaveBar isDirty isSubmitting={false} status="saved" />)
    const error = renderToStaticMarkup(<SettingsSaveBar isDirty isSubmitting={false} status="error" error="No se pudo guardar" />)

    expect(idle).toContain('disabled=""')
    expect(idle).toContain('Guardar cambios')
    expect(submitting).toContain('disabled=""')
    expect(submitting).toContain('Guardando…')
    expect(saved).toContain('Cambios guardados')
    expect(dirtyAfterSaved).toContain('Cambios sin guardar')
    expect(dirtyAfterSaved).not.toContain('Cambios guardados')
    expect(error).toContain('No se pudo guardar')
    expect(error).toContain('aria-live="polite"')
  })

  it('keeps navigation semantic and the form content unwrapped by decorative cards', () => {
    mockPathname.mockReturnValue('/dashboard/settings/profile')

    const html = renderToStaticMarkup(
      <SettingsShell>
        <SettingsFormSection title="Perfil público" description="Así te ven quienes reservan.">
          <label htmlFor="business-name">Nombre</label>
          <input id="business-name" />
        </SettingsFormSection>
        <SettingsSaveBar isDirty isSubmitting={false} status="idle" />
      </SettingsShell>,
    )

    expect(html).toContain('<nav aria-label="Secciones de configuración"')
    expect(html).toContain('<section aria-labelledby=')
    expect(html).toContain('Así te ven quienes reservan.')
    expect(html).toContain('lg:sticky')
    expect(html).toContain('p-5')
    expect(html).toContain('md:p-10')
    expect(html).toContain('overflow-x-clip')
    expect(html).toContain('-mx-5')
    expect(html).toContain('md:-mx-10')
    expect(html).toContain('lg:mx-0')
    expect(html).toContain('motion-reduce:transition-none')
  })
})
