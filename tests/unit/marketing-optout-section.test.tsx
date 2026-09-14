import { act } from 'react'
import { createRoot } from 'react-dom/client'
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

  it('confirma la baja en la misma página después de guardarla', async () => {
    const action = vi.fn(async () => {})
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    await act(async () => root.render(<MarketingOptOutSection businessName="Studio Andrea" optedOut={false} action={action} />))

    await act(async () => {
      host.querySelector<HTMLButtonElement>('button')!.click()
      await Promise.resolve()
    })

    expect(action).toHaveBeenCalledWith(true)
    expect(host.textContent).toContain('No recibirás promociones de Studio Andrea')
    expect(host.querySelector('[role="status"]')?.textContent).toContain('Preferencia guardada')

    await act(async () => root.unmount())
    host.remove()
  })
})
