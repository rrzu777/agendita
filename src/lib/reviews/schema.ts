import { z } from 'zod'

export const submitReviewSchema = z.object({
  bookingId: z.string().min(1, 'ID de reserva requerido'),
  token: z.string().min(1, 'Token requerido'),
  rating: z
    .number()
    .int('La calificación debe ser un número entero')
    .min(1, 'La calificación mínima es 1')
    .max(5, 'La calificación máxima es 5'),
  comment: z
    .string()
    .trim()
    .max(1000, 'El comentario es demasiado largo')
    .optional()
    .nullable()
    .or(z.literal('')),
}).strip()

export type SubmitReviewInput = z.input<typeof submitReviewSchema>
export type SubmitReviewOutput = z.output<typeof submitReviewSchema>

export const getReviewRequestSchema = z.object({
  bookingId: z.string().min(1, 'ID de reserva requerido'),
  token: z.string().min(1, 'Token requerido'),
}).strip()
