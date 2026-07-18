import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('@/server/actions/campaigns', () => ({
  sendCampaignEmailBatch: vi.fn(),
  sendCampaignMessage: vi.fn(),
}))

// LANDMINE: sin este mock renderToStaticMarkup explota con useRouter.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}))

const base = { grantStatus: null, optedOut: false } as const

describe('BulkSendControls', () => {
  it('muestra el botón de email masivo con el conteo de pendientes de email', async () => {
    const { BulkSendControls } = await import('@/app/dashboard/campanas/[id]/bulk-send-controls')
    const html = renderToStaticMarkup(
      <BulkSendControls
        campaignId="c1"
        recipients={[
          { ...base, id: 'r1', name: 'A', phone: '1', email: 'a@x.com', sentAt: null, channel: 'email' },
          { ...base, id: 'r2', name: 'B', phone: '1', email: 'b@x.com', sentAt: null, channel: 'email' },
          { ...base, id: 'r3', name: 'C', phone: '+56911111111', email: null, sentAt: null, channel: 'whatsapp' },
        ]}
      />,
    )
    expect(html).toContain('Enviar todos los emails')
    expect(html).toContain('2') // 2 pendientes de email
    expect(html).toContain('WhatsApp guiado')
  })

  it('no muestra controles cuando no hay pendientes', async () => {
    const { BulkSendControls } = await import('@/app/dashboard/campanas/[id]/bulk-send-controls')
    const html = renderToStaticMarkup(
      <BulkSendControls
        campaignId="c1"
        recipients={[
          { ...base, id: 'r1', name: 'A', phone: '1', email: 'a@x.com', sentAt: new Date(), channel: 'email' },
        ]}
      />,
    )
    expect(html).not.toContain('Enviar todos los emails')
    expect(html).not.toContain('WhatsApp guiado')
  })
})
