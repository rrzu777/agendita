import { z } from 'zod'
import { REWARD_TYPES, withRewardRules } from '@/lib/rewards/schema'

export const CAMPAIGN_SEGMENTS = ['birthday_month', 'inactive', 'frequent', 'pending_balance'] as const
export type CampaignSegmentType = (typeof CAMPAIGN_SEGMENTS)[number]

export const DEFAULT_INACTIVE_DAYS = 60
export const DEFAULT_FREQUENT_MIN = 3

const optPositiveInt = z.coerce.number().int().optional().nullable().transform((v) => (v != null && v > 0 ? v : null))

/** Recompensa inline para crear una promo de campaña (granted, pointsCost null). */
export const campaignRewardSchema = withRewardRules(
  z.object({
    name: z.string().trim().min(1, 'El nombre es requerido').max(60),
    rewardType: z.enum(REWARD_TYPES),
    rewardValue: z.coerce.number().int().nonnegative(),
    maxDiscount: optPositiveInt,
    appliesToAll: z.boolean(),
    serviceIds: z.array(z.string().min(1)).optional().default([]),
    grantExpiryDays: optPositiveInt,
  }),
)

export const campaignSegmentParamsSchema = z.object({
  inactiveDays: z.coerce.number().int().positive().optional(),
  frequentMin: z.coerce.number().int().positive().optional(),
})

export const createCampaignSchema = z
  .object({
    name: z.string().trim().min(1, 'El nombre es requerido').max(80),
    segmentType: z.enum(CAMPAIGN_SEGMENTS),
    segmentParams: campaignSegmentParamsSchema.optional(),
    messageTemplate: z.string().trim().min(1, 'El mensaje es requerido').max(1000),
    promotionId: z.string().min(1).optional(),
    newPromotion: campaignRewardSchema.optional(),
  })
  .refine((d) => !!d.promotionId || !!d.newPromotion, {
    message: 'Elige una promo del catálogo o crea una nueva', path: ['promotionId'],
  })

export type CreateCampaignInput = z.infer<typeof createCampaignSchema>
export type CampaignRewardInput = z.infer<typeof campaignRewardSchema>
