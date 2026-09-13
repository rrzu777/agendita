import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { OnboardingWizard } from '@/components/onboarding/onboarding-wizard'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }))
vi.mock('@/server/actions/onboarding', () => ({ completeOnboarding: vi.fn(), saveOnboardingStep: vi.fn() }))

describe('owner activation orientation', () => {
  it('exposes all five steps with a named current step and no nested link/button', () => {
    const html = renderToStaticMarkup(<OnboardingWizard business={{ id: 'business', name: 'Negocio', slug: 'negocio', subdomain: 'negocio', city: 'Santiago', bio: null, addressText: null, whatsapp: null, instagram: null, depositPolicy: null, cancellationPolicy: null, bookingPolicy: null, onboardingStep: 0 }} servicesCount={1} availabilityCount={5} publicUrl="https://example.test" bookingUrl="https://example.test/book" />)
    const document = new DOMParser().parseFromString(html, 'text/html')
    expect(document.querySelectorAll('h1')).toHaveLength(1)
    expect(document.querySelectorAll('ol[aria-label="Pasos de configuración"] > li')).toHaveLength(5)
    expect(document.querySelector('[aria-current="step"]')?.textContent).toBe('Tu negocio')
    expect(document.querySelector('a button, button a')).toBeNull()
  })
})
