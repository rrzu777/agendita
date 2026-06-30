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
