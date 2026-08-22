import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const refresh = vi.hoisted(() => vi.fn())

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))
vi.mock('@/server/actions/customers', () => ({ updateCustomer: vi.fn(), updateCustomerNotes: vi.fn() }))
vi.mock('@/server/actions/loyalty', () => ({ adjustCustomerPoints: vi.fn(), redeemPointsAsOwner: vi.fn() }))
vi.mock('@/server/actions/packages', () => ({ sellPackage: vi.fn(), refundPackagePurchase: vi.fn() }))
vi.mock('@/server/actions/customer-photos', () => ({
  attachCustomerPhoto: vi.fn(),
  createCustomerPhotoUploadUrl: vi.fn(),
  deleteCustomerPhoto: vi.fn(),
  getPhotos: vi.fn(),
  updateCustomerPhotoCaption: vi.fn(),
}))
vi.mock('@/components/vocabulary-provider', () => ({
  useVocabulary: () => ({ theClient: 'la clienta' }),
}))

function byLabel(container: HTMLElement, text: string) {
  const label = Array.from(container.querySelectorAll('label')).find((item) => item.textContent?.startsWith(text))
  const id = label?.getAttribute('for')
  const control = id ? container.querySelector<HTMLElement>(`#${id}`) : null
  if (!control) throw new Error(`Control not found for ${text}`)
  return control
}

function button(container: HTMLElement, text: string) {
  const match = Array.from(container.querySelectorAll('button')).find((item) => item.textContent?.trim() === text)
  if (!match) throw new Error(`Button not found: ${text}`)
  return match
}

describe('customer form system', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    vi.clearAllMocks()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
  })

  it('uses semantic form fields and form density when editing customer data', async () => {
    const { CustomerEditForm } = await import('@/app/dashboard/customers/[id]/edit-form')
    await act(async () => root.render(
      <CustomerEditForm customer={{ id: 'customer-1', name: 'Ana', phone: '+56912345678', email: 'ana@example.com', birthDate: null }} />,
    ))
    await act(async () => button(container, 'Editar datos').click())

    for (const label of ['Nombre', 'Telefono', 'Email', 'Fecha de nacimiento']) {
      expect(byLabel(container, label).getAttribute('data-density')).toBe('form')
    }
    expect(container.querySelector('#birthDate-help')?.textContent).toContain('Opcional')
    expect(button(container, 'Guardar').getAttribute('data-size')).toBe('form')
  })

  it('labels internal notes and keeps its counter in the accessible description', async () => {
    const { CustomerNotesForm } = await import('@/app/dashboard/customers/[id]/notes-form')
    await act(async () => root.render(<CustomerNotesForm customerId="customer-1" initialNotes={null} />))
    await act(async () => button(container, 'Agregar notas').click())

    const notes = byLabel(container, 'Notas internas')
    expect(notes.getAttribute('data-density')).toBe('form')
    expect(notes.getAttribute('aria-describedby')).toBe('customer-notes-help')
    expect(button(container, 'Guardar').getAttribute('data-size')).toBe('form')
  })

  it('uses explicit labels and form geometry for loyalty adjustments', async () => {
    const { LoyaltyPanel } = await import('@/app/dashboard/customers/[id]/loyalty-panel')
    await act(async () => root.render(
      <LoyaltyPanel customerId="customer-1" balance={10} history={[]} label="puntos" catalog={[]} grants={[]} />,
    ))

    expect(byLabel(container, 'Puntos a ajustar').getAttribute('data-density')).toBe('form')
    expect(byLabel(container, 'Motivo del ajuste').getAttribute('data-density')).toBe('form')
    expect(button(container, 'Ajustar').getAttribute('data-size')).toBe('form')
  })

  it('uses explicit labels and form geometry for package sales', async () => {
    const { PackagePanel } = await import('@/app/dashboard/customers/[id]/package-panel')
    await act(async () => root.render(
      <PackagePanel customerId="customer-1" packages={[]} products={[{ id: 'pack-1', name: 'Pack', price: 10000 }]} currency="CLP" />,
    ))

    expect(byLabel(container, 'Paquete').getAttribute('data-density')).toBe('form')
    expect(byLabel(container, 'Método de pago').getAttribute('data-density')).toBe('form')
    expect(button(container, 'Vender').getAttribute('data-size')).toBe('form')
  })

  it('keeps photo captions compact without the legacy input class', async () => {
    const { CustomerPhotos } = await import('@/components/dashboard/customer-photos')
    await act(async () => root.render(
      <CustomerPhotos
        target={{ customerId: 'customer-1' }}
        initialPhotos={[{ id: 'photo-1', bookingId: null, url: '/dashboard/photos/photo-1', caption: 'Antes', createdAt: '2026-01-01T00:00:00.000Z' }]}
        uploadEnabled={false}
      />,
    ))

    const caption = container.querySelector('[aria-label="Nota de la foto"]')
    expect(caption?.getAttribute('data-density')).toBe('compact')
    expect(caption?.classList.contains('studio-input')).toBe(false)
  })
})
