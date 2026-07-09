import { renderToStaticMarkup } from 'react-dom/server'
import { describe, it, expect } from 'vitest'
import { StatusBadge } from '@/components/ui/status-badge'

describe('StatusBadge domain maps', () => {
  it('service map: active/inactive', () => {
    expect(renderToStaticMarkup(<StatusBadge map="service" status="active" />)).toContain('Activo')
    expect(renderToStaticMarkup(<StatusBadge map="service" status="inactive" />)).toContain('Inactivo')
  })
  it('review map: pending/approved/hidden', () => {
    expect(renderToStaticMarkup(<StatusBadge map="review" status="approved" />)).toContain('Aprobada')
  })
  it('payment map: approved/rejected', () => {
    expect(renderToStaticMarkup(<StatusBadge map="payment" status="rejected" />)).toContain('Rechazado')
  })
  it('promo map: Programada (keys are capitalized, from derivePromoStatus)', () => {
    expect(renderToStaticMarkup(<StatusBadge map="promo" status="Programada" />)).toContain('Programada')
  })
  it('direction map: expense', () => {
    expect(renderToStaticMarkup(<StatusBadge map="direction" status="expense" />)).toContain('Gasto')
  })
  it('subscription map: 5 estados reales (no bucketing)', () => {
    expect(renderToStaticMarkup(<StatusBadge map="subscription" status="trialing" />)).toContain('En prueba')
    expect(renderToStaticMarkup(<StatusBadge map="subscription" status="past_due" />)).toContain('Pago pendiente')
  })
})
