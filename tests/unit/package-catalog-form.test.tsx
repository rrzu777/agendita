import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { PackageCatalog } from '@/app/dashboard/paquetes/package-catalog'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))

describe('PackageCatalog form', () => {
  it('labels required and optional package fields without native validation bubbles', () => {
    const html = renderToStaticMarkup(
      <PackageCatalog products={[]} services={[]} currency="CLP" />,
    )
    const host = document.createElement('div')
    host.innerHTML = html

    const form = host.querySelector('form')
    expect(form?.noValidate).toBe(true)
    expect(host.querySelector('label[for="package-name"]')?.textContent).toContain('Nombre del paquete')
    expect(host.querySelector('#package-name')?.getAttribute('aria-required')).toBe('true')
    expect(host.querySelector('label[for="package-bonus"]')?.parentElement?.textContent).toContain('Opcional')
    expect(host.textContent).toContain('Aún no hay paquetes configurados')
  })
})
