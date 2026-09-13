import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { PackageCatalog } from '@/app/dashboard/paquetes/package-catalog'

const mockUpsert = vi.hoisted(() => vi.fn())
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('@/server/actions/packages', () => ({ upsertPackageProduct: mockUpsert, archivePackageProduct: vi.fn() }))

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

  it('blocks invalid package fields, focuses the first error, and submits after recovery', async () => {
    mockUpsert.mockResolvedValue({ ok: true, data: {} })
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    await act(async () => root.render(<PackageCatalog products={[]} services={[]} currency="CLP" />))
    const form = container.querySelector('form')!
    await act(async () => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
    const name = container.querySelector<HTMLInputElement>('#package-name')!
    expect(mockUpsert).not.toHaveBeenCalled()
    expect(name.getAttribute('aria-describedby')).toContain('package-name-error')
    expect(document.activeElement).toBe(name)

    await act(async () => { name.value = 'Pack 5'; name.dispatchEvent(new Event('input', { bubbles: true })) })
    expect(name.getAttribute('aria-invalid')).toBe('false')
    expect(container.querySelector('#package-name-error')).toBeNull()

    await act(async () => {
      container.querySelector<HTMLInputElement>('#package-quantity')!.value = '5'; container.querySelector<HTMLInputElement>('#package-price')!.value = '10000'
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await Promise.resolve()
    })
    expect(mockUpsert).toHaveBeenCalledTimes(1)
    expect(name.getAttribute('aria-invalid')).toBe('false')
    await act(async () => root.unmount())
    container.remove()
  })

  it('uses 44px actions in the archive dialog and restores focus on cancel', async () => {
    const container = document.createElement('div'); document.body.appendChild(container); const root = createRoot(container)
    await act(async () => root.render(<PackageCatalog products={[{ id: 'p1', name: 'Pack', quantity: 2, bonusQuantity: 0, price: 1000, expiryDays: null, appliesToAll: true, isActive: true, services: [] }]} services={[]} currency="CLP" />))
    const trigger = Array.from(container.querySelectorAll('button')).find((item) => item.textContent === 'Desactivar')!
    await act(async () => trigger.click())
    const dialog = document.body.querySelector<HTMLElement>('[role="dialog"]')!
    const safe = Array.from(dialog.querySelectorAll('button')).find((item) => item.textContent === 'Conservar paquete')!
    const confirm = Array.from(dialog.querySelectorAll('button')).find((item) => item.textContent === 'Desactivar paquete')!
    expect(safe.getAttribute('data-size')).toBe('form')
    expect(confirm.getAttribute('data-size')).toBe('form')
    expect(safe.className).toContain('min-h-11')
    expect(confirm.className).toContain('min-h-11')
    await act(async () => { safe.click(); await new Promise((resolve) => setTimeout(resolve, 0)) })
    expect(document.activeElement).toBe(trigger)
    await act(async () => root.unmount()); container.remove()
  })
})
