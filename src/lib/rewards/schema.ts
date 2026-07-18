import { z } from 'zod'

/** Los tres tipos de recompensa de un grant/promo. Fuente única del enum, reusado
 *  por los schemas de promoción, campaña, canje por puntos y regla automática. */
export const REWARD_TYPES = ['percentage', 'fixed_amount', 'free_service'] as const
export type RewardType = (typeof REWARD_TYPES)[number]

/** Forma mínima que un schema de recompensa debe producir para aplicarle las reglas. */
interface RewardShape {
  rewardType: RewardType
  rewardValue: number
  appliesToAll: boolean
  serviceIds: string[]
}

/** Normaliza y valida el bloque de recompensa compartido por los schemas de promoción,
 *  campaña y canje: free_service anula el valor, el porcentaje va de 1 a 100 y —si no
 *  aplica a todos los servicios— hay que elegir al menos uno. Devuelve el schema con el
 *  tail encadenado; el caller puede seguir agregando `.refine(...)` propios (p. ej. fechas). */
export function withRewardRules<Out extends RewardShape, In>(schema: z.ZodType<Out, In>) {
  return schema
    .transform((d): Out => (d.rewardType === 'free_service' ? { ...d, rewardValue: 0 } : d))
    .refine((d) => d.rewardType !== 'percentage' || (d.rewardValue >= 1 && d.rewardValue <= 100), {
      message: 'El porcentaje debe estar entre 1 y 100',
      path: ['rewardValue'],
    })
    .refine((d) => d.appliesToAll || d.serviceIds.length > 0, {
      message: 'Elige al menos un servicio o aplica a todos',
      path: ['serviceIds'],
    })
}
