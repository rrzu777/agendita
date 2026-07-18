import { describe, expect, it, vi, beforeEach } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

const mockSendCampaignMessage = vi.hoisted(() => vi.fn())
const mockSendCampaignEmail = vi.hoisted(() => vi.fn())

vi.mock('@/server/actions/campaigns', () => ({
  sendCampaignMessage: mockSendCampaignMessage,
  sendCampaignEmail: mockSendCampaignEmail,
}))

// LANDMINE del repo: sin este mock renderToStaticMarkup explota con useRouter.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  redirect: vi.fn(),
  notFound: vi.fn(),
}))

describe('RecipientList', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders metrics, send buttons and sent indicator', async () => {
    const { RecipientList } = await import('@/app/dashboard/campanas/[id]/recipient-list')

    const html = renderToStaticMarkup(
      <RecipientList
        campaignId="c1"
        recipients={[
          {
            id: 'r1',
            name: 'Ana Pérez',
            phone: '+56911111111',
            email: null,
            sentAt: new Date('2026-07-10T12:00:00Z'),
            grantStatus: 'active',
            optedOut: false,
            channel: 'whatsapp',
          },
          {
            id: 'r2',
            name: 'Berta Soto',
            phone: '+56922222222',
            email: null,
            sentAt: null,
            grantStatus: null,
            optedOut: false,
            channel: 'whatsapp',
          },
        ]}
        metrics={{ enviadas: 3, canjearon: 2, vigentes: 1 }}
      />,
    )

    // Botón de envío para la que no se envió todavía.
    expect(html).toContain('Enviar por WhatsApp')
    // Indicador de enviada + botón de reenvío para la que ya tiene sentAt.
    expect(html).toContain('Enviado')
    expect(html).toContain('Reenviar')

    expect(html).toContain('Ana Pérez')
    expect(html).toContain('Berta Soto')

    // Métricas: labels + números como contenido de elemento (no clases tipo p-5).
    expect(html).toContain('Destinatarias')
    expect(html).toContain('Enviadas')
    expect(html).toContain('Canjearon')
    expect(html).toContain('Vigentes')
    // "Destinatarias" ahora se deriva de recipients.length (2 en este render).
    expect(html).toContain('>2<')
    expect(html).toContain('>3<')
    expect(html).toContain('>2<')
    expect(html).toContain('>1<')
  })

  it('shows redeemed indicator when the grant is redeemed', async () => {
    const { RecipientList } = await import('@/app/dashboard/campanas/[id]/recipient-list')

    const html = renderToStaticMarkup(
      <RecipientList
        campaignId="c1"
        recipients={[
          {
            id: 'r1',
            name: 'Carla Díaz',
            phone: '+56933333333',
            email: null,
            sentAt: new Date('2026-07-10T12:00:00Z'),
            grantStatus: 'redeemed',
            optedOut: false,
            channel: 'whatsapp',
          },
        ]}
        metrics={{ enviadas: 1, canjearon: 1, vigentes: 0 }}
      />,
    )

    expect(html).toContain('Canjeado')
  })

  it('renders empty state when there are no recipients', async () => {
    const { RecipientList } = await import('@/app/dashboard/campanas/[id]/recipient-list')

    const html = renderToStaticMarkup(
      <RecipientList
        campaignId="c1"
        recipients={[]}
        metrics={{ enviadas: 0, canjearon: 0, vigentes: 0 }}
      />,
    )

    expect(html).toContain('Sin destinatarias')
  })

  it('opt-out: fila "No contactar" sin botón de envío + métrica derivada con su conteo', async () => {
    const { RecipientList } = await import('@/app/dashboard/campanas/[id]/recipient-list')

    const html = renderToStaticMarkup(
      <RecipientList
        campaignId="c1"
        recipients={[
          { id: 'r1', name: 'Ana', phone: '+56911110001', email: null, sentAt: null, grantStatus: null, optedOut: true, channel: 'whatsapp' },
        ]}
        metrics={{ enviadas: 0, canjearon: 0, vigentes: 0 }}
      />,
    )

    expect(html).toContain('No contactar')
    expect(html).not.toContain('Enviar por WhatsApp')
    // La métrica se deriva de recipients (1 opt-out en este render).
    expect(html).toContain('>1<')
  })

  it('canal email: muestra "Enviar email" y no el botón de WhatsApp', async () => {
    const { RecipientList } = await import('@/app/dashboard/campanas/[id]/recipient-list')

    const html = renderToStaticMarkup(
      <RecipientList
        campaignId="c1"
        recipients={[
          { id: 'r1', name: 'Mai Mail', phone: '1', email: 'mai@example.com', sentAt: null, grantStatus: null, optedOut: false, channel: 'email' },
        ]}
        metrics={{ enviadas: 0, canjearon: 0, vigentes: 0 }}
      />,
    )

    expect(html).toContain('Enviar email')
    expect(html).not.toContain('Enviar por WhatsApp')
  })
})
