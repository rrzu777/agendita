import { z } from 'zod'
import { normalizePhone } from './phone'

export const updateCustomerSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'El nombre es requerido')
    .max(100, 'El nombre es demasiado largo'),
  phone: z
    .string()
    .trim()
    .min(8, 'El telefono debe tener al menos 8 digitos')
    .max(20, 'El telefono es demasiado largo')
    .transform(normalizePhone)
    .refine((p) => p.length >= 8, 'El telefono normalizado es demasiado corto')
    .refine((p) => p.length <= 20, 'El telefono normalizado es demasiado largo'),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email('Email invalido')
    .max(254)
    .optional()
    .nullable()
    .or(z.literal('')),
  // Fecha de nacimiento (YYYY-MM-DD). Opcional. '' o null => sin fecha.
  birthDate: z
    .string()
    .trim()
    .optional()
    .nullable()
    .or(z.literal(''))
    .transform((v) => (v ? v : null))
    .refine(
      (v) => v === null || /^\d{4}-\d{2}-\d{2}$/.test(v),
      'Fecha de nacimiento invalida',
    )
    .refine((v) => {
      if (v === null) return true
      const d = new Date(`${v}T00:00:00Z`)
      if (isNaN(d.getTime())) return false
      const year = d.getUTCFullYear()
      // Rango razonable: entre 1900 y hoy (sin fechas futuras).
      return year >= 1900 && d.getTime() <= Date.now()
    }, 'La fecha de nacimiento no es valida'),
}).strip()

export const updateCustomerNotesSchema = z.object({
  notes: z
    .string()
    .trim()
    .max(2000, 'Las notas son demasiado largas')
    .optional()
    .nullable()
    .or(z.literal('')),
}).strip()
