import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

import { MarketingOptOutSection } from '@/components/loyalty/marketing-optout-section'

const noop = vi.fn(async () => {})

describe('MarketingOptOutSection', () => {
  it('cuando acepta: link discreto de baja con el nombre del negocio', () => {
    const html = renderToStaticMarkup(
      <MarketingOptOutSection businessName="Studio Andrea" optedOut={false} action={noop} />,
    )
    expect(html).toContain('No quiero recibir promociones de Studio Andrea')
    expect(html).not.toContain('Volver a recibirlas')
  })

  it('cuando está opt-out: estado + botón de re-alta', () => {
    const html = renderToStaticMarkup(
      <MarketingOptOutSection businessName="Studio Andrea" optedOut={true} action={noop} />,
    )
    expect(html).toContain('No recibirás promociones de Studio Andrea')
    expect(html).toContain('Volver a recibirlas')
  })
})
