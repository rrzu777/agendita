import { describe, it, expect, afterEach } from 'vitest'

const original = { ...process.env }
afterEach(() => {
  process.env = { ...original }
})

async function load() {
  // Re-import fresh so the env is read at call time (functions read env directly).
  return await import('@/lib/business/urls')
}

describe('getBusinessPublicUrl', () => {
  it('puts tenant subdomains on the apex domain, stripping a leading www', async () => {
    process.env.NEXT_PUBLIC_APP_DOMAIN = 'www.agendita.cl'
    const { getBusinessPublicUrl } = await load()
    expect(getBusinessPublicUrl({ slug: 'x', subdomain: 'rzlabstest' })).toBe(
      'https://rzlabstest.agendita.cl',
    )
  })

  it('keeps an apex subdomain unchanged', async () => {
    process.env.NEXT_PUBLIC_APP_DOMAIN = 'agendita.cl'
    const { getBusinessPublicUrl } = await load()
    expect(getBusinessPublicUrl({ slug: 'x', subdomain: 'rzlabstest' })).toBe(
      'https://rzlabstest.agendita.cl',
    )
  })

  it('uses the configured host (incl. www) for businesses without a subdomain', async () => {
    process.env.NEXT_PUBLIC_APP_DOMAIN = 'www.agendita.cl'
    const { getBusinessPublicUrl } = await load()
    expect(getBusinessPublicUrl({ slug: 'mitienda', subdomain: null })).toBe(
      'https://www.agendita.cl/b/mitienda',
    )
  })

  it('appends the path to a subdomain URL', async () => {
    process.env.NEXT_PUBLIC_APP_DOMAIN = 'www.agendita.cl'
    const { getBusinessPublicUrl } = await load()
    expect(getBusinessPublicUrl({ slug: 'x', subdomain: 'rzlabstest' }, '/book')).toBe(
      'https://rzlabstest.agendita.cl/book',
    )
  })
})

describe('public acquisition navigation', () => {
  it('preserves referral separately and only bounded allowlisted acquisition values', async () => {
    const { publicAcquisitionSearch } = await load()
    const result = new URLSearchParams(publicAcquisitionSearch(new URLSearchParams('ref=74d2b4a1-c53a-41d5-a145-5318f1d2d382&acq=abcdefghijklmnopqrstuv&utm_source=IG&utm_medium=social&utm_campaign=link-public&credential=secret&email=name@example.com&continuar=1')))
    expect(Object.fromEntries(result)).toEqual({ ref: '74d2b4a1-c53a-41d5-a145-5318f1d2d382', acq: 'abcdefghijklmnopqrstuv', utm_source: 'instagram', utm_medium: 'social', utm_campaign: 'link-public', continuar: '1' })
    expect(publicAcquisitionSearch({ acq: ['first', 'second'], ref: 'malformed', utm_medium: 'private text', continuar: 'arbitrary' })).toBe('')
  })
  it('keeps the same allowed context through login alias and restores continuar independently', async () => {
    const { getBookingLoginUrl, appendPublicAcquisitionSearch } = await load()
    const search = new URLSearchParams('acq=abcdefghijklmnopqrstuv&ref=74d2b4a1-c53a-41d5-a145-5318f1d2d382')
    const login = new URL(getBookingLoginUrl('salon', search), 'https://agendita.test')
    expect(login.searchParams.get('next')).toBe('/ir/salon?ref=74d2b4a1-c53a-41d5-a145-5318f1d2d382&acq=abcdefghijklmnopqrstuv')
    expect(appendPublicAcquisitionSearch('/book', search)).toBe('/book?ref=74d2b4a1-c53a-41d5-a145-5318f1d2d382&acq=abcdefghijklmnopqrstuv')
  })
})

describe('getBookingConfirmationUrl', () => {
  it('subdomain business → apex subdomain confirmation path', async () => {
    process.env.NEXT_PUBLIC_APP_DOMAIN = 'www.agendita.cl'
    const { getBookingConfirmationUrl } = await load()
    const url = getBookingConfirmationUrl({ slug: 'bella', subdomain: 'bella' }, 'bk_1')
    expect(url).toBe('https://bella.agendita.cl/book/confirmation?bookingId=bk_1')
  })

  it('non-subdomain business → /b/<slug> confirmation path (quirk pre-existente, se preserva)', async () => {
    process.env.NEXT_PUBLIC_APP_DOMAIN = 'www.agendita.cl'
    const { getBookingConfirmationUrl } = await load()
    const url = getBookingConfirmationUrl({ slug: 'bella', subdomain: null }, 'bk_1')
    expect(url).toBe('https://www.agendita.cl/b/bella/book/confirmation?bookingId=bk_1')
  })
})

describe('getBookingFunnelUrl', () => {
  it('points a subdomain tenant at /book on its apex host', async () => {
    process.env.NEXT_PUBLIC_APP_DOMAIN = 'www.agendita.cl'
    const { getBookingFunnelUrl } = await load()
    expect(getBookingFunnelUrl({ slug: 'x', subdomain: 'rzlabstest' }, 'ref=tok123')).toBe(
      'https://rzlabstest.agendita.cl/book?ref=tok123',
    )
  })

  it('uses /book/{slug} for businesses without a subdomain (funnel, not landing)', async () => {
    process.env.NEXT_PUBLIC_APP_DOMAIN = 'www.agendita.cl'
    const { getBookingFunnelUrl } = await load()
    expect(getBookingFunnelUrl({ slug: 'mitienda', subdomain: null }, 'ref=tok123')).toBe(
      'https://www.agendita.cl/book/mitienda?ref=tok123',
    )
  })

  it('omits the query string when no search is given', async () => {
    process.env.NEXT_PUBLIC_APP_DOMAIN = 'agendita.cl'
    const { getBookingFunnelUrl } = await load()
    expect(getBookingFunnelUrl({ slug: 'x', subdomain: 'sub' })).toBe(
      'https://sub.agendita.cl/book',
    )
  })

  it('uses http for localhost', async () => {
    process.env.NEXT_PUBLIC_APP_DOMAIN = 'localhost:3000'
    const { getBookingFunnelUrl } = await load()
    expect(getBookingFunnelUrl({ slug: 'mitienda', subdomain: null }, 'ref=t')).toBe(
      'http://localhost:3000/book/mitienda?ref=t',
    )
  })
})
