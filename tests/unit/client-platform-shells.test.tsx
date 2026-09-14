import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { ClientAccountShell, ClientBusinessShell, TenantPublicShell } from '@/components/client/client-shell'
import { AuthShell, LegalShell, MarketingShell } from '@/components/platform/platform-shell'
import { PackagesBusinessPage } from '@/components/packages/packages-business-page'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }))
vi.mock('@/server/actions/packages-checkout', () => ({ createPackagePurchase: vi.fn(), initiatePackagePayment: vi.fn(), declarePackageTransfer: vi.fn() }))

describe('client account shells', () => {
  it('keeps the account switcher separate from owner navigation', () => {
    const html = renderToStaticMarkup(
      <ClientAccountShell accountAction={<button type="button">Salir</button>}>
        <h1>Mis negocios</h1>
      </ClientAccountShell>,
    )

    expect(html).toContain('Mi cuenta')
    expect(html).toContain('Mis negocios')
    expect(html).not.toContain('Calendario')
    expect(html).not.toContain('Finanzas')
  })

  it('renders tenant-first navigation and a persistent booking action', () => {
    const html = renderToStaticMarkup(
      <ClientBusinessShell
        business={{
          name: 'Barber Profit',
          logoUrl: null,
          brandColor: '#35524A',
          visualStyle: 'contrast',
          category: 'barber',
        }}
        bookingHref="https://barberprofit.agendita.cl"
      >
        <h1>Tu cuenta en Barber Profit</h1>
      </ClientBusinessShell>,
    )

    expect(html).toContain('data-business-theme')
    expect(html).toContain('data-visual-style="contrast"')
    expect(html).toContain('Próximas')
    expect(html).toContain('Historial')
    expect(html).toContain('Beneficios')
    expect(html).toContain('Preferencias')
    expect(html).toContain('Reservar')
    expect(html).toContain('aria-current="location"')
    expect(html).toContain('href="https://barberprofit.agendita.cl"')
    expect(html).toContain('sm:right-6')
    expect(html).not.toContain('sm:sticky')
    expect(html).not.toContain('pink')
  })

  it('keeps public loyalty and commerce states inside the tenant identity', () => {
    const html = renderToStaticMarkup(
      <TenantPublicShell
        business={{ name: 'Mimos', logoUrl: null, brandColor: '#B64D68', visualStyle: 'soft', category: 'nails' }}
        backHref="/b/mimos"
        backLabel="Volver al perfil"
      >
        <h1>Paquetes</h1>
      </TenantPublicShell>,
    )
    expect(html).toContain('data-business-theme')
    expect(html).toContain('Mimos')
    expect(html).toContain('Volver al perfil')
    expect(html).not.toContain('bg-pink')
  })

  it('points contextual route navigation back to the business account sections', () => {
    const html = renderToStaticMarkup(
      <ClientBusinessShell
        business={{ name: 'Mimos', logoUrl: null, brandColor: null, visualStyle: 'balanced', category: 'nails' }}
        bookingHref="/book/mimos"
        sectionBaseHref="/mi/mimos"
      >
        <h1>Reprogramar</h1>
      </ClientBusinessShell>,
    )
    expect(html).toContain('href="/mi/mimos#proximas"')
    expect(html).not.toContain('href="#proximas"')
  })

  it('updates the current in-page section from hash navigation without scroll spying', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    window.history.replaceState(null, '', '#proximas')
    await act(async () => root.render(
      <ClientBusinessShell business={{ name: 'Mimos', logoUrl: null, brandColor: null, visualStyle: 'balanced', category: 'nails' }} bookingHref="/book/mimos">
        <h1>Cuenta</h1>
      </ClientBusinessShell>,
    ))

    expect(host.querySelector('a[href="#proximas"]')?.getAttribute('aria-current')).toBe('location')
    window.history.replaceState(null, '', '#historial')
    await act(async () => window.dispatchEvent(new HashChangeEvent('hashchange')))
    expect(host.querySelector('a[href="#historial"]')?.getAttribute('aria-current')).toBe('location')
    expect(host.querySelector('a[href="#proximas"]')?.getAttribute('aria-current')).toBeNull()

    await act(async () => root.unmount())
    host.remove()
    window.history.replaceState(null, '', window.location.pathname)
  })
})

describe('platform shells', () => {
  it('distinguishes owner access from client access', () => {
    const owner = renderToStaticMarkup(<AuthShell audience="owner"><h1>Iniciar sesión</h1></AuthShell>)
    const client = renderToStaticMarkup(<AuthShell audience="client"><h1>Mis reservas</h1></AuthShell>)

    expect(owner).toContain('Gestiona tu negocio')
    expect(client).toContain('Tus reservas y beneficios')
    expect(owner).not.toEqual(client)
    expect(owner).toContain('100dvh-6rem')
    expect(owner).not.toContain('100vh-4rem')
  })

  it('gives legal pages a shared landmark and useful navigation', () => {
    const html = renderToStaticMarkup(<LegalShell currentPage="privacy"><h1>Privacidad</h1></LegalShell>)
    expect(html).toContain('aria-label="Documentos legales"')
    expect(html).toContain('Privacidad')
    expect(html).toContain('Términos')
    expect(html).toContain('Reembolsos')
    expect(html).toContain('href="/privacy"')
    expect(html).toContain('aria-current="page"')
  })

  it('keeps marketing navigation focused and free of owner sidebar destinations', () => {
    const html = renderToStaticMarkup(<MarketingShell><h1>Agenda online</h1></MarketingShell>)
    expect(html).toContain('Para negocios')
    expect(html).toContain('Soy cliente')
    expect(html).not.toContain('Finanzas')
  })
})

describe('tenant commerce shell', () => {
  it('uses the business theme and truthful empty catalog state', () => {
    const html = renderToStaticMarkup(
      <PackagesBusinessPage
        business={{ id: 'b1', name: 'Barber Profit', slug: 'barberprofit', logoUrl: null, brandColor: '#35524A', visualStyle: 'contrast', category: 'barber', currency: 'CLP', packageProducts: [] } as never}
        profileHref="/b/barberprofit"
        onlineAvailable={false}
        onlineReason={null}
        prefill={null}
        transferInfo={null}
      />,
    )
    expect(html).toContain('data-visual-style="contrast"')
    expect(html).toContain('Barber Profit')
    expect(html).toContain('todavía no publicó paquetes')
  })

  it('keeps transfer-only package checkout available when Mercado Pago is unavailable', () => {
    const html = renderToStaticMarkup(
      <PackagesBusinessPage
        business={{ id: 'b1', name: 'Mimos', slug: 'mimos', logoUrl: null, brandColor: null, visualStyle: 'balanced', category: 'nails', currency: 'CLP', packageProducts: [{ id: 'p1', name: 'Pack 5', quantity: 5, bonusQuantity: 0, price: 50000, expiryDays: null, appliesToAll: true, services: [] }] } as never}
        profileHref="/b/mimos"
        onlineAvailable={false}
        onlineReason="Mercado Pago no está conectado."
        prefill={{ email: 'ana@example.com', name: 'Ana', phone: '+56911112222' }}
        preselectedProductId="p1"
        transferInfo={{ accountHolder: 'Mimos', rut: '1-9', bankName: 'BancoEstado', accountType: 'vista', accountNumber: '123', email: null, instructions: null, holdHours: 24, requireProof: false }}
      />,
    )
    expect(html).toContain('Acepto los términos')
    expect(html).not.toContain('No disponible online')
    expect(html).toContain('<h2')
    expect(html).not.toContain('<h3')
  })
})
