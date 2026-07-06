import { z } from 'zod'

export const updateBusinessSchema = z.object({
  name: z.string().max(100).transform(v => v.trim()).refine(v => v.length > 0, 'El nombre es obligatorio'),
  bio: z.string().max(500).optional(),
  profileImageUrl: z.string().url('URL inválida').optional().or(z.literal('')),
  logoUrl: z.string().url('URL inválida').optional().or(z.literal('')),
  whatsapp: z.string().optional().or(z.literal('')),
  instagram: z.string().optional().or(z.literal('')),
  addressText: z.string().optional(),
  city: z.string().transform(v => v.trim()).refine(v => v.length > 0, 'La ciudad es obligatoria'),
  timezone: z.string().default('America/Santiago'),
  // Cada cuántos minutos ofrecer horas de inicio en la página pública;
  // 'service' = según la duración del servicio (agenda compacta) → null en BD.
  slotStepMinutes: z.enum(['15', '30', '45', '60', 'service']).default('30'),
  subdomain: z.string()
    .min(3, 'Mínimo 3 caracteres')
    .max(30, 'Máximo 30 caracteres')
    .regex(/^[a-zA-Z0-9-]+$/, 'Solo letras, números y guiones')
    .transform(v => v.toLowerCase()),
  cancellationPolicy: z.string().optional(),
  bookingPolicy: z.string().optional(),
  depositPolicy: z.string().optional(),
})

export type UpdateBusinessInput = z.input<typeof updateBusinessSchema>
export type UpdateBusinessOutput = z.output<typeof updateBusinessSchema>

/** Valor del form → minutos para Business.slotStepMinutes (null = duración del servicio). */
export function slotStepToMinutes(value: UpdateBusinessOutput['slotStepMinutes']): number | null {
  return value === 'service' ? null : Number(value)
}
