import { z } from 'zod'
import { normalizeWhatsapp, normalizeInstagram } from './normalize'

export const updateBusinessSchema = z.object({
  name: z.string().min(1, 'El nombre es obligatorio').max(100),
  bio: z.string().max(500).optional(),
  profileImageUrl: z.string().url('URL inválida').optional().or(z.literal('')),
  logoUrl: z.string().url('URL inválida').optional().or(z.literal('')),
  whatsapp: z.string().optional().or(z.literal('')),
  instagram: z.string().optional().or(z.literal('')),
  addressText: z.string().optional(),
  city: z.string().min(1, 'La ciudad es obligatoria'),
  timezone: z.string().default('America/Santiago'),
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
