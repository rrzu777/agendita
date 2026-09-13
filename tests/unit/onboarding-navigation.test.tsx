import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { OnboardingWizard } from '@/components/onboarding/onboarding-wizard'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }))
vi.mock('@/server/actions/onboarding', () => ({ completeOnboarding: vi.fn(), saveOnboardingStep: vi.fn() }))

describe('owner activation orientation', () => {
  it.each([0, 1, 2, 3, 4])('keeps every enabled action at least 44px on step %s, including empty setup recovery', (onboardingStep) => {
    const html = renderToStaticMarkup(<OnboardingWizard business={{ id: 'business', name: 'Negocio', slug: 'negocio', subdomain: 'negocio', city: 'Santiago', bio: null, addressText: null, whatsapp: null, instagram: null, depositPolicy: null, cancellationPolicy: null, bookingPolicy: null, onboardingStep }} servicesCount={0} availabilityCount={0} publicUrl="https://example.test" bookingUrl="https://example.test/book" />)
    const document = new DOMParser().parseFromString(html, 'text/html')
    const actions = [...document.querySelectorAll('button:not(:disabled), a[href]')]
    expect(actions.length).toBeGreaterThan(0)
    for (const action of actions) {
      expect(action.classList.contains('min-h-11'), action.textContent ?? '').toBe(true)
      expect(action.classList.contains('min-w-11'), action.textContent ?? '').toBe(true)
    }
  })

  it('keeps the enabled completion action at least 44px when setup is ready', () => {
    const html = renderToStaticMarkup(<OnboardingWizard business={{ id: 'business', name: 'Negocio', slug: 'negocio', subdomain: 'negocio', city: 'Santiago', bio: null, addressText: null, whatsapp: null, instagram: null, depositPolicy: null, cancellationPolicy: null, bookingPolicy: null, onboardingStep: 4 }} servicesCount={1} availabilityCount={1} publicUrl="https://example.test" bookingUrl="https://example.test/book" />)
    const document = new DOMParser().parseFromString(html, 'text/html')
    const finish = [...document.querySelectorAll('button')].find(button => button.textContent?.includes('¡Listo!'))!
    expect(finish.disabled).toBe(false)
    expect(finish.classList.contains('min-h-11')).toBe(true)
    expect(finish.classList.contains('min-w-11')).toBe(true)
  })

  it('exposes all five steps with a named current step and no nested link/button', () => {
    const html = renderToStaticMarkup(<OnboardingWizard business={{ id: 'business', name: 'Negocio', slug: 'negocio', subdomain: 'negocio', city: 'Santiago', bio: null, addressText: null, whatsapp: null, instagram: null, depositPolicy: null, cancellationPolicy: null, bookingPolicy: null, onboardingStep: 0 }} servicesCount={1} availabilityCount={5} publicUrl="https://example.test" bookingUrl="https://example.test/book" />)
    const document = new DOMParser().parseFromString(html, 'text/html')
    expect(document.querySelectorAll('h1')).toHaveLength(1)
    expect(document.querySelectorAll('ol[aria-label="Pasos de configuración"] > li')).toHaveLength(5)
    expect(document.querySelector('[aria-current="step"]')?.textContent).toBe('Tu negocio')
    expect(document.querySelector('a button, button a')).toBeNull()
  })
})
