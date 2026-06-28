import { z } from 'zod'

export function normalizeCode(code: string | null | undefined): string | null {
  if (!code) return null
  const t = code.trim().toUpperCase()
  return t === '' ? null : t
}

// Fecha (YYYY-MM-DD). Opcional. '' o null => null. Valida formato y que sea
// una fecha real vía round-trip (igual que birthDate en customers/schema.ts):
// sin esto, strings basura llegan a `new Date(...)` aguas abajo (Task 6/8) y
// producen Invalid Date -> 500 opaco de Prisma.
const dateStr = z.string().trim().optional().nullable().or(z.literal(''))
  .transform((v) => (v ? v : null))
  .refine((v) => v === null || /^\d{4}-\d{2}-\d{2}$/.test(v), 'Fecha inválida')
  .refine((v) => {
    if (v === null) return true
    const d = new Date(`${v}T00:00:00Z`)
    return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v
  }, 'Fecha inválida')

export const createPromotionSchema = z.object({
  name: z.string().trim().min(1, 'El nombre es requerido').max(100),
  description: z.string().trim().max(500).optional().nullable().or(z.literal('')).transform((v) => (v ? v : null)),
  code: z.string().trim().max(40).optional().nullable().or(z.literal(''))
    .transform((v) => normalizeCode(v))
    .refine((v) => v === null || /^[A-Z0-9_-]{2,40}$/.test(v), 'Código inválido (2–40, A–Z 0–9 _ -)'),
  rewardType: z.enum(['percentage', 'fixed_amount', 'free_service']),
  rewardValue: z.number().int().nonnegative(),
  maxDiscount: z.number().int().positive().optional().nullable(),
  appliesToAll: z.boolean(),
  serviceIds: z.array(z.string().min(1)).optional().default([]),
  validFrom: dateStr,
  validUntil: dateStr,
  minSpend: z.number().int().nonnegative().optional().nullable(),
  maxRedemptions: z.number().int().positive().optional().nullable(),
  maxPerCustomer: z.number().int().positive().optional().nullable(),
}).strip()
  .transform((d) => (d.rewardType === 'free_service' ? { ...d, rewardValue: 0 } : d))
  .refine((d) => d.rewardType !== 'percentage' || (d.rewardValue >= 1 && d.rewardValue <= 100),
    { message: 'El porcentaje debe estar entre 1 y 100', path: ['rewardValue'] })
  .refine((d) => d.appliesToAll || d.serviceIds.length > 0,
    { message: 'Elige al menos un servicio o aplica a todos', path: ['serviceIds'] })
  .refine((d) => !d.validFrom || !d.validUntil || new Date(d.validUntil) > new Date(d.validFrom),
    { message: 'La fecha de fin debe ser posterior a la de inicio', path: ['validUntil'] })

// update == create; the post-redemption code-lock lives in the server action
export const updatePromotionSchema = createPromotionSchema

export type CreatePromotionInput = z.infer<typeof createPromotionSchema>
export type CreatePromotionFormInput = z.input<typeof createPromotionSchema>
