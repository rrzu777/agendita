import { describe, it, expect } from 'vitest'
import { renderCampaignMessage, defaultMessageForSegment } from '@/lib/campaigns/message'

describe('renderCampaignMessage', () => {
  it('sustituye todos los placeholders', () => {
    const out = renderCampaignMessage('Hola {nombre}, tu código {codigo} vence {vencimiento} — {negocio}', {
      nombre: 'Ana', codigo: 'ABC123', vencimiento: '31/07/2026', negocio: 'Studio',
    })
    expect(out).toBe('Hola Ana, tu código ABC123 vence 31/07/2026 — Studio')
  })
  it('placeholder repetido se reemplaza todas las veces', () => {
    expect(renderCampaignMessage('{nombre} {nombre}', { nombre: 'Ana', codigo: '', vencimiento: '', negocio: '' }))
      .toBe('Ana Ana')
  })
  it('placeholder desconocido queda literal', () => {
    expect(renderCampaignMessage('{otro}', { nombre: 'A', codigo: '', vencimiento: '', negocio: '' })).toBe('{otro}')
  })
  it('default por segmento contiene {nombre} y {codigo}', () => {
    const d = defaultMessageForSegment('birthday_month')
    expect(d).toContain('{nombre}')
    expect(d).toContain('{codigo}')
  })
})
