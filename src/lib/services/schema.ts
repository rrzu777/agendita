import { z } from 'zod'
import { ServiceModality } from '@prisma/client'

const hexColorRegex = /^#[0-9A-Fa-f]{6}$/

// Al menos una: un servicio sin modalidades no se puede reservar en ningún lado,
// y el funnel tendría que inventar un default.
const modalitiesSchema = z
  .array(z.nativeEnum(ServiceModality))
  .min(1, 'Elegí al menos una modalidad')
  // El formulario manda checkboxes: sin dedup, dos clicks rápidos podrían
  // persistir ['at_home','at_home'] y el picker mostraría la opción repetida.
  .transform((values) => [...new Set(values)])

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
  modalities: modalitiesSchema.default([ServiceModality.on_site]),
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
  modalities: modalitiesSchema.optional(),
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
