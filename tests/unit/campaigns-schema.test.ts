import { describe, it, expect } from 'vitest'
import {
  createCampaignSchema, CAMPAIGN_SEGMENTS, DEFAULT_INACTIVE_DAYS, DEFAULT_FREQUENT_MIN,
} from '@/lib/campaigns/schema'

describe('campaigns schema', () => {
  it('acepta campaña con promo del catálogo', () => {
    const r = createCampaignSchema.safeParse({
      name: 'Cumple julio', segmentType: 'birthday_month',
      messageTemplate: 'Hola {nombre}', promotionId: 'promo1',
    })
    expect(r.success).toBe(true)
  })
  it('acepta campaña con promo inline (sin promotionId)', () => {
    const r = createCampaignSchema.safeParse({
      name: 'Winback', segmentType: 'inactive', segmentParams: { inactiveDays: 90 },
      messageTemplate: 'Te extrañamos {nombre} {codigo}',
      newPromotion: { name: '20% off', rewardType: 'percentage', rewardValue: 20, appliesToAll: true, serviceIds: [] },
    })
    expect(r.success).toBe(true)
  })
  it('rechaza si no hay ni promotionId ni newPromotion', () => {
    const r = createCampaignSchema.safeParse({
      name: 'X', segmentType: 'frequent', messageTemplate: 'hola',
    })
    expect(r.success).toBe(false)
  })
  it('defaults expuestos', () => {
    expect(DEFAULT_INACTIVE_DAYS).toBe(60)
    expect(DEFAULT_FREQUENT_MIN).toBe(3)
    expect(CAMPAIGN_SEGMENTS).toContain('birthday_month')
  })
})
