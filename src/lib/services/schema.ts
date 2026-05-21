import { z } from 'zod'

const hexColorRegex = /^#[0-9A-Fa-f]{6}$/

export const createServiceSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'El nombre es requerido')
    .max(100, 'El nombre es demasiado largo'),
  description: z.string().trim().max(500, 'La descripción es demasiado larga').optional().nullable(),
  durationMinutes: z
    .number()
    .int('Debe ser un número entero')
    .min(15, 'La duración mínima es 15 minutos')
    .max(480, 'La duración máxima es 480 minutos'),
  price: z
    .number()
    .int('Debe ser un número entero')
    .nonnegative('El precio no puede ser negativo'),
  depositAmount: z
    .number()
    .int('Debe ser un número entero')
    .nonnegative('El abono no puede ser negativo'),
  pastelColor: z.string().regex(hexColorRegex, 'El color debe tener formato #RRGGBB'),
  isActive: z.boolean().optional(),
  sortOrder: z
    .number()
    .int()
    .nonnegative('El orden debe ser un número positivo')
    .optional(),
}).refine((data) => data.depositAmount <= data.price, {
  message: 'El abono no puede superar el precio',
  path: ['depositAmount'],
}).strip()

export const updateServiceSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'El nombre es requerido')
    .max(100, 'El nombre es demasiado largo')
    .optional(),
  description: z.string().trim().max(500, 'La descripción es demasiado larga').optional().nullable(),
  durationMinutes: z
    .number()
    .int('Debe ser un número entero')
    .min(15, 'La duración mínima es 15 minutos')
    .max(480, 'La duración máxima es 480 minutos')
    .optional(),
  price: z
    .number()
    .int('Debe ser un número entero')
    .nonnegative('El precio no puede ser negativo')
    .optional(),
  depositAmount: z
    .number()
    .int('Debe ser un número entero')
    .nonnegative('El abono no puede ser negativo')
    .optional(),
  pastelColor: z.string().regex(hexColorRegex, 'El color debe tener formato #RRGGBB').optional(),
  sortOrder: z
    .number()
    .int()
    .nonnegative('El orden debe ser un número positivo')
    .optional(),
}).strip()

export const reorderSchema = z.object({
  items: z.array(z.object({
    id: z.string(),
    sortOrder: z.number().int().nonnegative(),
  })),
}).strip()
