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
  cardMessage: optText(200),
}).strip()

export const adjustPointsSchema = z.object({
  delta: z.coerce.number().int().refine((v) => v !== 0, 'El ajuste no puede ser 0'),
  note: z.string().trim().min(1, 'La nota es requerida').max(200),
}).strip()

export type LoyaltyConfigInput = z.infer<typeof loyaltyConfigSchema>
export type LoyaltyConfigFormInput = z.input<typeof loyaltyConfigSchema>
export type AdjustPointsInput = z.infer<typeof adjustPointsSchema>
