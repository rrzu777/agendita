import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import {
  marketingUnsubscribeUrl, unsubscribeHeaders, unsubscribeFooterHtml, unsubscribeFooterText,
} from '@/lib/notifications/marketing-email'
import { campaignPromoHtml, campaignPromoText } from '@/lib/notifications/templates'

describe('marketing-email builders', () => {
  const OLD = process.env.NEXT_PUBLIC_APP_DOMAIN
  beforeEach(() => { process.env.NEXT_PUBLIC_APP_DOMAIN = 'app.example.com' })
  afterEach(() => { process.env.NEXT_PUBLIC_APP_DOMAIN = OLD })

  it('builds the /baja page URL from the token', () => {
    expect(marketingUnsubscribeUrl('tok123')).toBe('https://app.example.com/baja/tok123')
  })

  it('emits one-click List-Unsubscribe headers pointing at the api route', () => {
    const h = unsubscribeHeaders('tok123')
    expect(h['List-Unsubscribe']).toBe('<https://app.example.com/api/baja/tok123>')
    expect(h['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click')
  })

  it('footer text/html contain the baja link', () => {
    expect(unsubscribeFooterText('tok123')).toContain('https://app.example.com/baja/tok123')
    expect(unsubscribeFooterHtml('tok123')).toContain('href="https://app.example.com/baja/tok123"')
  })
})

describe('campaignPromo templates', () => {
  it('html escapes the message, converts newlines, and appends the unsubscribe footer', () => {
    const html = campaignPromoHtml({
      businessName: 'Studio X',
      message: 'Hola <Ana>\nvení pronto',
      unsubscribeFooterHtml: '<p>UNSUB-MARKER</p>',
    })
    expect(html).toContain('Hola &lt;Ana&gt;')
    expect(html).toContain('<br>')
    expect(html).toContain('UNSUB-MARKER')
    expect(html).toContain('Studio X') // transactional footer still present
  })

  it('text joins message and footer', () => {
    const text = campaignPromoText('cuerpo del mensaje', 'baja: https://x/baja/t')
    expect(text).toContain('cuerpo del mensaje')
    expect(text).toContain('baja: https://x/baja/t')
  })
})
