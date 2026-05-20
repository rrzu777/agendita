import { z } from 'zod'
import { normalizeWhatsapp, normalizeInstagram } from './normalize'

export const updateBusinessSchema = z.object({
  name: z.string().min(1, 'El nombre es obligatorio').max(100),
  bio: z.string().max(500).optional().transform(v => v?.trim() || null),
  profileImageUrl: z.string().url('URL inválida').optional().or(z.literal('')).transform(v => v?.trim() || null),
  logoUrl: z.string().url('URL inválida').optional().or(z.literal('')).transform(v => v?.trim() || null),
  whatsapp: z.string().optional().or(z.literal('')).transform(v => normalizeWhatsapp(v) || null),
  instagram: z.string().optional().or(z.literal('')).transform(v => normalizeInstagram(v) || null),
  addressText: z.string().optional().transform(v => v?.trim() || null),
  city: z.string().min(1, 'La ciudad es obligatoria'),
  timezone: z.string().default('America/Santiago'),
  subdomain: z.string()
    .min(3, 'Mínimo 3 caracteres')
    .max(30, 'Máximo 30 caracteres')
    .regex(/^[a-zA-Z0-9-]+$/, 'Solo letras, números y guiones')
    .transform(v => v.toLowerCase()),
  cancellationPolicy: z.string().optional().transform(v => v?.trim() || null),
  bookingPolicy: z.string().optional().transform(v => v?.trim() || null),
  depositPolicy: z.string().optional().transform(v => v?.trim() || null),
})

export type UpdateBusinessInput = z.input<typeof updateBusinessSchema>
export type UpdateBusinessOutput = z.output<typeof updateBusinessSchema>
