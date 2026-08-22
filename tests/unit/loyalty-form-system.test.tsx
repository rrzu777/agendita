import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/server/actions/loyalty', () => ({
  archiveAutomaticRule: vi.fn(),
  archiveRedemptionOption: vi.fn(),
  upsertAutomaticRule: vi.fn(),
  upsertLoyaltyConfig: vi.fn(),
  upsertRedemptionOption: vi.fn(),
}))

function controlByLabel(container: HTMLElement, text: string) {
  const label = Array.from(container.querySelectorAll('label')).find((item) =>
    item.textContent?.startsWith(text),
  )
  const id = label?.getAttribute('for')
  const control = id ? container.querySelector<HTMLElement>(`#${id}`) : null
  if (!control) throw new Error(`Control not found for ${text}`)
  return control
}

function button(container: HTMLElement, text: string) {
  const match = Array.from(container.querySelectorAll('button')).find(
    (item) => item.textContent?.trim() === text,
  )
  if (!match) throw new Error(`Button not found: ${text}`)
  return match
}

describe('loyalty form system', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
  })

  it('uses explicit form-density fields in loyalty configuration', async () => {
    const { LoyaltyConfigForm } = await import(
      '@/app/dashboard/fidelizacion/loyalty-config-form'
    )
    await act(async () => root.render(<LoyaltyConfigForm config={null} />))

    expect(controlByLabel(container, 'Nombre del programa').getAttribute('data-density')).toBe('form')
    expect(controlByLabel(container, 'Nombre de la unidad').getAttribute('data-density')).toBe('form')
    expect(controlByLabel(container, 'Puntos por visita').getAttribute('data-density')).toBe('form')
    expect(button(container, 'Guardar').getAttribute('data-size')).toBe('form')
  })

  it('labels dense automatic-rule controls without changing native choices', async () => {
    const { AutomaticRules } = await import('@/app/dashboard/fidelizacion/automatic-rules')
    await act(async () => root.render(
      <AutomaticRules
        rules={[{
          id: 'rule-1',
          isActive: true,
          priority: 10,
          rewardType: 'percentage',
          rewardValue: 15,
          rewardPoints: null,
          maxDiscount: 5000,
          appliesToAll: true,
          grantExpiryDays: 30,
          maxPerCustomer: 1,
          conditions: { kind: 'birthday', windowDays: 7 },
          services: [],
        }]}
        services={[]}
        pointsLabel="puntos"
        currency="CLP"
      />,
    ))

    const birthdayForm = container.querySelector<HTMLFormElement>('form')
    expect(birthdayForm).not.toBeNull()
    expect(controlByLabel(birthdayForm!, 'Tipo de beneficio').getAttribute('data-density')).toBe('form')
    expect(controlByLabel(birthdayForm!, 'Valor del beneficio').getAttribute('data-density')).toBe('form')
    expect(controlByLabel(birthdayForm!, 'Ventana de cumpleaños').getAttribute('data-density')).toBe('form')
    expect(button(birthdayForm!, 'Guardar cambios').getAttribute('data-size')).toBe('form')
  })

  it('uses labeled form controls in the redemption editor', async () => {
    const { RedemptionCatalog } = await import('@/app/dashboard/fidelizacion/redemption-catalog')
    await act(async () => root.render(<RedemptionCatalog options={[]} services={[]} />))

    expect(controlByLabel(container, 'Nombre de la recompensa').getAttribute('data-density')).toBe('form')
    expect(controlByLabel(container, 'Tipo de beneficio').getAttribute('data-density')).toBe('form')
    expect(controlByLabel(container, 'Costo en puntos').getAttribute('data-density')).toBe('form')
    expect(button(container, 'Agregar recompensa').getAttribute('data-size')).toBe('form')
  })
})
