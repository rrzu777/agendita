import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

describe('legal pages', () => {
  it('loads terms page', async () => {
    const { default: TermsPage } = await import('@/app/terms/page')
    expect(renderToStaticMarkup(<TermsPage />)).toContain('Términos y Condiciones')
  })

  it('loads privacy page', async () => {
    const { default: PrivacyPage } = await import('@/app/privacy/page')
    expect(renderToStaticMarkup(<PrivacyPage />)).toContain('Política de Privacidad')
  })

  it('loads refund policy page', async () => {
    const { default: RefundPolicyPage } = await import('@/app/refund-policy/page')
    expect(renderToStaticMarkup(<RefundPolicyPage />)).toContain('Política de Reembolsos')
  })
})
