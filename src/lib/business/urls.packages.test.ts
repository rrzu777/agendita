import { describe, it, expect } from 'vitest'
import { getPackageConfirmationUrl } from './urls'

describe('getPackageConfirmationUrl', () => {
  it('path style sin subdominio', () => {
    const url = getPackageConfirmationUrl({ slug: 'demo', subdomain: null }, 'p1')
    expect(url).toContain('/b/demo/paquetes/confirmation?purchaseId=p1')
  })
  it('subdominio', () => {
    const url = getPackageConfirmationUrl({ slug: 'demo', subdomain: 'demo' }, 'p1')
    expect(url).toContain('demo.')
    expect(url).toContain('/paquetes/confirmation?purchaseId=p1')
  })
})
