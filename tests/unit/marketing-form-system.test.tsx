import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clickButton } from '../helpers/react-dom'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }))
const { mockCreatePromotion, mockCreateCampaign } = vi.hoisted(() => ({ mockCreatePromotion: vi.fn(), mockCreateCampaign: vi.fn() }))
vi.mock('@/server/actions/promotions', () => ({ createPromotion: mockCreatePromotion, updatePromotion: vi.fn() }))
vi.mock('@/server/actions/campaigns', () => ({ createCampaign: mockCreateCampaign }))
vi.mock('@/components/vocabulary-provider', () => ({
  useVocabulary: () => ({ clients: 'clientas', theClient: 'la clienta' }),
}))

describe('marketing form system', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    mockCreatePromotion.mockReset()
    mockCreateCampaign.mockReset()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
  })

  it('uses labeled form-density controls in the promotion dialog', async () => {
    const { PromotionForm } = await import('@/app/dashboard/promociones/promotion-form')
    await act(async () => root.render(<PromotionForm services={[]} currency="CLP" />))
    await clickButton(container, 'Nueva promoción', { match: 'contains' })

    const dialog = document.body.querySelector('[role="dialog"]')
    expect(dialog).not.toBeNull()
    expect(dialog?.querySelectorAll('[data-slot="form-field"]').length).toBeGreaterThanOrEqual(9)
    expect(dialog?.querySelector<HTMLInputElement>('#promotion-name')?.getAttribute('data-density')).toBe('form')
    expect(dialog?.querySelector<HTMLTextAreaElement>('#promotion-description')?.getAttribute('data-density')).toBe('form')
    expect(Array.from(dialog?.querySelectorAll('button') ?? []).find((item) => item.textContent === '% descuento')?.className).toContain('md:min-h-10')
    expect(dialog?.querySelector<HTMLButtonElement>('button[type="submit"]')?.getAttribute('data-size')).toBe('touch')
  })

  it('uses labeled controls and a native shared select in the campaign dialog', async () => {
    const { NewCampaignDialog } = await import('@/app/dashboard/campanas/new-campaign-dialog')
    await act(async () => root.render(
      <NewCampaignDialog promotions={[{ id: 'promo-1', name: 'Promo' }]} services={[]} currency="CLP" />,
    ))
    await clickButton(container, 'Nueva campaña', { match: 'contains' })

    const dialog = document.body.querySelector('[role="dialog"]')
    expect(dialog?.querySelector<HTMLInputElement>('#campaign-name')?.getAttribute('data-density')).toBe('form')
    expect(dialog?.querySelector<HTMLSelectElement>('#campaign-promotion')?.getAttribute('data-density')).toBe('form')
    expect(dialog?.querySelector<HTMLTextAreaElement>('#campaign-message')?.getAttribute('data-density')).toBe('form')
    expect(dialog?.querySelector<HTMLButtonElement>('button[aria-pressed="true"]')?.className).toContain('md:min-h-10')
    expect(dialog?.querySelector<HTMLButtonElement>('button[type="submit"]')?.getAttribute('data-size')).toBe('touch')
  })

  it.each([
    ['promotion', 'Nueva promoción', '#promotion-name', mockCreatePromotion],
    ['campaign', 'Nueva campaña', '#campaign-name', mockCreateCampaign],
  ] as const)('blocks and associates an invalid %s name before any action', async (_kind, trigger, selector, action) => {
    if (_kind === 'promotion') {
      const { PromotionForm } = await import('@/app/dashboard/promociones/promotion-form')
      await act(async () => root.render(<PromotionForm services={[]} currency="CLP" />))
    } else {
      const { NewCampaignDialog } = await import('@/app/dashboard/campanas/new-campaign-dialog')
      await act(async () => root.render(<NewCampaignDialog promotions={[{ id: 'p1', name: 'Promo' }]} services={[]} currency="CLP" />))
    }
    await clickButton(container, trigger, { match: 'contains' })
    const form = document.body.querySelector<HTMLFormElement>('[role="dialog"] form')!
    await act(async () => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
    const field = document.body.querySelector<HTMLInputElement>(selector)!
    expect(action).not.toHaveBeenCalled()
    expect(field.getAttribute('aria-invalid')).toBe('true')
    expect(field.getAttribute('aria-describedby')).toContain(`${field.id}-error`)
    expect(document.activeElement).toBe(field)
    action.mockResolvedValue(_kind === 'campaign' ? { ok: true, data: { campaignId: 'campaign-1' } } : { ok: true, data: {} })
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      setter.call(field, 'Nombre válido'); field.dispatchEvent(new Event('input', { bubbles: true }))
      if (_kind === 'promotion') {
        const reward = document.body.querySelector<HTMLInputElement>('#reward-value')!
        setter.call(reward, '20'); reward.dispatchEvent(new Event('input', { bubbles: true }))
      }
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await Promise.resolve()
    })
    expect(action).toHaveBeenCalledTimes(1)
  })
})
