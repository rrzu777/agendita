import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clickButton } from '../helpers/react-dom'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }))
vi.mock('@/server/actions/promotions', () => ({ createPromotion: vi.fn(), updatePromotion: vi.fn() }))
vi.mock('@/server/actions/campaigns', () => ({ createCampaign: vi.fn() }))
vi.mock('@/components/vocabulary-provider', () => ({
  useVocabulary: () => ({ clients: 'clientas', theClient: 'la clienta' }),
}))

describe('marketing form system', () => {
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
})
