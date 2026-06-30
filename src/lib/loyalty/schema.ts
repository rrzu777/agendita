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
  clawbackAutoRewardOnRefund: z.boolean().optional().default(false),
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

export const AUTOMATIC_KINDS = ['birthday','first_visit','review','anniversary','winback','referral'] as const
export type AutomaticKind = (typeof AUTOMATIC_KINDS)[number]

/** Una regla automática define UNA forma de recompensa: puntos directos (rewardKind
 *  'points') o un grant reusable (rewardKind 'grant', con los campos de descuento). */
export const automaticRuleSchema = z.object({
  kind: z.enum(AUTOMATIC_KINDS),
  isActive: z.boolean(),
  priority: z.coerce.number().int().min(0).max(1000).default(0),
  rewardKind: z.enum(['points', 'grant']),
  rewardPoints: z.coerce.number().int().optional().nullable(),
  rewardType: z.enum(['percentage', 'fixed_amount', 'free_service']).optional().nullable(),
  rewardValue: z.coerce.number().int().nonnegative().optional().default(0),
  maxDiscount: optPositiveInt,
  appliesToAll: z.boolean().default(true),
  serviceIds: z.array(z.string().min(1)).optional().default([]),
  grantExpiryDays: optPositiveInt,
  maxPerCustomer: optPositiveInt,
  // Parámetros por kind (se ignoran los no aplicables):
  windowDays: z.coerce.number().int().min(0).max(60).optional().default(0),
  inactivityDays: z.coerce.number().int().min(0).max(3650).optional().default(0),
  cooldownDays: z.coerce.number().int().min(0).max(3650).optional().default(0),
  beneficiary: z.enum(['both', 'referrer', 'referred']).optional().default('both'),
}).strip()
  // Normaliza la rama de recompensa elegida y anula la otra.
  .transform((d) => {
    if (d.rewardKind === 'points') {
      return { ...d, rewardType: null, rewardValue: 0, maxDiscount: null,
        rewardPoints: d.rewardPoints && d.rewardPoints > 0 ? d.rewardPoints : null }
    }
    const rewardValue = d.rewardType === 'free_service' ? 0 : d.rewardValue
    return { ...d, rewardPoints: null, rewardValue }
  })
  .refine((d) => d.rewardKind !== 'points' || (d.rewardPoints != null && d.rewardPoints > 0),
    { message: 'Los puntos de la recompensa deben ser mayores a 0', path: ['rewardPoints'] })
  .refine((d) => d.rewardKind !== 'grant' || d.rewardType != null,
    { message: 'Elige el tipo de recompensa', path: ['rewardType'] })
  .refine((d) => d.rewardKind !== 'grant' || d.rewardType !== 'percentage'
      || (d.rewardValue >= 1 && d.rewardValue <= 100),
    { message: 'El porcentaje debe estar entre 1 y 100', path: ['rewardValue'] })
  .refine((d) => d.rewardKind !== 'grant' || d.appliesToAll || d.serviceIds.length > 0,
    { message: 'Elige al menos un servicio o aplica a todos', path: ['serviceIds'] })
  .refine((d) => d.kind !== 'winback' || d.inactivityDays > 0,
    { message: 'La inactividad debe ser mayor a 0 días', path: ['inactivityDays'] })

export type AutomaticRuleInput = z.infer<typeof automaticRuleSchema>
export type AutomaticRuleFormInput = z.input<typeof automaticRuleSchema>

/** Arma el JSON `conditions` que se guarda en la Promotion a partir de la regla validada. */
export function buildConditions(d: AutomaticRuleInput): Record<string, unknown> {
  return { kind: d.kind, windowDays: d.windowDays, inactivityDays: d.inactivityDays,
    cooldownDays: d.cooldownDays, beneficiary: d.beneficiary }
}
