import { z } from 'zod'

// Entero opcional positivo; '' / 0 / negativo / null => null (off).
const optPositiveInt = z.coerce.number().int().optional().nullable()
  .transform((v) => (v && v > 0 ? v : null))

const optText = (max: number) => z.string().trim().max(max).optional().nullable()
  .transform((v) => (v ? v : null))

export const loyaltyConfigSchema = z.object({
  isActive: z.boolean(),
  programName: z.string().trim().min(1, 'El nombre del programa es requerido').max(60),
  pointsLabel: z.string().trim().min(1).max(20).optional().default('puntos'),
  pointsPerVisit: z.coerce.number().int().nonnegative().max(1_000_000),
  spendPerPoint: optPositiveInt,
  minSpendToEarn: optPositiveInt,
  grantExpiryDays: optPositiveInt,
  refundPointsOnExpiry: z.boolean().optional().default(true),
  forfeitGrantOnNoShow: z.boolean().optional().default(false),
  cardMessage: optText(200),
}).strip()

export const adjustPointsSchema = z.object({
  delta: z.coerce.number().int().refine((v) => v !== 0, 'El ajuste no puede ser 0'),
  note: z.string().trim().min(1, 'La nota es requerida').max(200),
}).strip()

export type LoyaltyConfigInput = z.infer<typeof loyaltyConfigSchema>
export type LoyaltyConfigFormInput = z.input<typeof loyaltyConfigSchema>
export type AdjustPointsInput = z.infer<typeof adjustPointsSchema>

export const redemptionOptionSchema = z.object({
  name: z.string().trim().min(1, 'El nombre es requerido').max(60),
  rewardType: z.enum(['percentage', 'fixed_amount', 'free_service']),
  rewardValue: z.coerce.number().int().nonnegative(),
  maxDiscount: optPositiveInt,
  pointsCost: z.coerce.number().int().positive('El costo en puntos debe ser mayor a 0'),
  appliesToAll: z.boolean(),
  serviceIds: z.array(z.string().min(1)).optional().default([]),
  grantExpiryDays: optPositiveInt,
  maxRedemptions: optPositiveInt,
  maxPerCustomer: optPositiveInt,
  isActive: z.boolean().optional().default(true),
}).strip()
  .transform((d) => (d.rewardType === 'free_service' ? { ...d, rewardValue: 0 } : d))
  .refine((d) => d.rewardType !== 'percentage' || (d.rewardValue >= 1 && d.rewardValue <= 100),
    { message: 'El porcentaje debe estar entre 1 y 100', path: ['rewardValue'] })
  .refine((d) => d.appliesToAll || d.serviceIds.length > 0,
    { message: 'Elige al menos un servicio o aplica a todos', path: ['serviceIds'] })

export const redeemSchema = z.object({
  optionId: z.string().min(1),
  requestId: z.string().min(1).max(100),
}).strip()

export type RedemptionOptionInput = z.infer<typeof redemptionOptionSchema>
export type RedemptionOptionFormInput = z.input<typeof redemptionOptionSchema>
