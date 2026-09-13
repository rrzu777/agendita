import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockUpsertConfig, mockUpsertRedemption, mockUpsertRule } = vi.hoisted(() => ({ mockUpsertConfig: vi.fn(), mockUpsertRedemption: vi.fn(), mockUpsertRule: vi.fn() }))
vi.mock('@/server/actions/loyalty', () => ({
  archiveAutomaticRule: vi.fn(),
  archiveRedemptionOption: vi.fn(),
  upsertAutomaticRule: mockUpsertRule,
  upsertLoyaltyConfig: mockUpsertConfig,
  upsertRedemptionOption: mockUpsertRedemption,
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
    mockUpsertConfig.mockReset()
    mockUpsertRedemption.mockReset()
    mockUpsertRule.mockReset()
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

  it('blocks an out-of-range automatic-rule value and focuses its associated field', async () => {
    const { AutomaticRules } = await import('@/app/dashboard/fidelizacion/automatic-rules')
    await act(async () => root.render(<AutomaticRules rules={[]} services={[]} pointsLabel="puntos" currency="CLP" />))
    const form = container.querySelector<HTMLFormElement>('form')!
    const priority = form.querySelector<HTMLInputElement>('#birthday-priority')!
    priority.value = '1001'
    await act(async () => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
    expect(mockUpsertRule).not.toHaveBeenCalled()
    expect(priority.getAttribute('aria-describedby')).toContain('birthday-priority-error')
    expect(document.activeElement).toBe(priority)
    await act(async () => { priority.value = '100'; priority.dispatchEvent(new Event('input', { bubbles: true })) })
    expect(priority.getAttribute('aria-invalid')).toBe('false')
    expect(container.querySelector('#birthday-priority-error')).toBeNull()
  })

  it('uses labeled form controls in the redemption editor', async () => {
    const { RedemptionCatalog } = await import('@/app/dashboard/fidelizacion/redemption-catalog')
    await act(async () => root.render(<RedemptionCatalog options={[]} services={[]} />))

    expect(controlByLabel(container, 'Nombre de la recompensa').getAttribute('data-density')).toBe('form')
    expect(controlByLabel(container, 'Tipo de beneficio').getAttribute('data-density')).toBe('form')
    expect(controlByLabel(container, 'Costo en puntos').getAttribute('data-density')).toBe('form')
    expect(button(container, 'Agregar recompensa').getAttribute('data-size')).toBe('form')
  })

  it('associates loyalty configuration errors and recovers without a premature action', async () => {
    mockUpsertConfig.mockResolvedValue({ ok: true, data: {} })
    const { LoyaltyConfigForm } = await import('@/app/dashboard/fidelizacion/loyalty-config-form')
    await act(async () => root.render(<LoyaltyConfigForm config={null} />))
    const form = container.querySelector('form')!
    await act(async () => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
    const name = container.querySelector<HTMLInputElement>('#programName')!
    expect(mockUpsertConfig).not.toHaveBeenCalled()
    expect(name.getAttribute('aria-describedby')).toContain('programName-error')
    expect(document.activeElement).toBe(name)
    await act(async () => { name.value = 'Club'; name.dispatchEvent(new Event('input', { bubbles: true })) })
    expect(name.getAttribute('aria-invalid')).toBe('false')
    expect(container.querySelector('#programName-error')).toBeNull()
    await act(async () => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await Promise.resolve() })
    expect(mockUpsertConfig).toHaveBeenCalledTimes(1)
  })

  it('associates redemption errors and submits only after recovery', async () => {
    mockUpsertRedemption.mockResolvedValue({ ok: true, data: {} })
    const { RedemptionCatalog } = await import('@/app/dashboard/fidelizacion/redemption-catalog')
    await act(async () => root.render(<RedemptionCatalog options={[]} services={[]} />))
    const form = container.querySelector('form')!
    await act(async () => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
    const name = container.querySelector<HTMLInputElement>('#redemption-name')!
    expect(mockUpsertRedemption).not.toHaveBeenCalled()
    expect(name.getAttribute('aria-describedby')).toContain('redemption-name-error')
    expect(document.activeElement).toBe(name)
    await act(async () => {
      name.value = 'Corte gratis'; name.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(name.getAttribute('aria-invalid')).toBe('false')
    expect(container.querySelector('#redemption-name-error')).toBeNull()
    await act(async () => { container.querySelector<HTMLInputElement>('#redemption-pointsCost')!.value = '10'; form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await Promise.resolve() })
    expect(mockUpsertRedemption).toHaveBeenCalledTimes(1)
  })
})
