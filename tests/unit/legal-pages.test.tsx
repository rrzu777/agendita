import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

describe('legal pages', () => {
  it('loads terms page', async () => {
    const { default: TermsPage } = await import('@/app/terms/page')
    const html = renderToStaticMarkup(<TermsPage />)
    expect(html).toContain('Términos y Condiciones')
    expect(html).toContain('cobros mensuales')
    expect(html).toContain('no se realizan cargos retroactivos')
    expect(html).toContain('cierre del período vigente')
  })

  it('loads privacy page', async () => {
    const { default: PrivacyPage } = await import('@/app/privacy/page')
    expect(renderToStaticMarkup(<PrivacyPage />)).toContain('Política de Privacidad')
  })

  it('loads refund policy page', async () => {
    const { default: RefundPolicyPage } = await import('@/app/refund-policy/page')
    const html = renderToStaticMarkup(<RefundPolicyPage />)
    expect(html).toContain('Política de Reembolsos')
    expect(html).toContain('cobros recurrentes mensuales')
    expect(html).toContain('no genera un reembolso automático')
    expect(html).not.toContain('pagos de suscripción se gestionan de forma manual')
  })
})
