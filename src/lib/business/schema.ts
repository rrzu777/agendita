import { z } from 'zod'

const nameField = z.string().max(100).transform(v => v.trim()).refine(v => v.length > 0, 'El nombre es obligatorio')
const bioField = z.string().max(500).optional()
const optionalUrlField = z.string().url('URL inválida').optional().or(z.literal(''))
const optionalStringField = z.string().optional().or(z.literal(''))
const cityField = z.string().transform(v => v.trim()).refine(v => v.length > 0, 'La ciudad es obligatoria')
const subdomainField = z.string()
  .min(3, 'Mínimo 3 caracteres')
  .max(30, 'Máximo 30 caracteres')
  .regex(/^[a-zA-Z0-9-]+$/, 'Solo letras, números y guiones')
  .transform(v => v.toLowerCase())
const timezoneField = z.string().default('America/Santiago')
// Cada cuántos minutos ofrecer horas de inicio en la página pública;
// 'service' = según la duración del servicio (agenda compacta) → null en BD.
const slotStepField = z.enum(['15', '30', '45', '60', 'service']).default('30')
// Hasta cuántas horas antes de la cita una clienta puede autogestionar
// (cancelar/reprogramar) su reserva desde /mi. 0 = sin límite.
// El input vacío ('') vuelve al default 24: Number('') === 0 y 0 significa
// "sin límite" — un campo borrado por accidente no debe abrir la ventana.
const cutoffField = z.preprocess(
  v => v === '' || v == null ? undefined : v,
  z.coerce.number().int().min(0).max(720).default(24),
)
// Cuántas horas se le guarda el horario a una reserva cuando el negocio
// coordina el abono a mano (sin pago online ni transferencia). Mínimo 1: un
// hold de 0 horas nacería vencido. Vacío → default 24, mismo criterio que
// arriba: un campo borrado por accidente no debe achicar la ventana.
const manualHoldField = z.preprocess(
  v => v === '' || v == null ? undefined : v,
  z.coerce.number().int().min(1).max(720).default(24),
)
// Sala fija de videollamada para los servicios online. URL completa: se manda
// tal cual por email, así que un "meet.google.com/xxx" sin esquema no serviría
// como link clickeable. Exigimos http(s) y prohibimos caracteres de control:
// el valor se usa como href público y también se escribe crudo en un .ics.
const meetingUrlField = z.string()
  .trim()
  .url('Tiene que ser un link completo, con https://')
  .refine(v => /^https?:\/\//i.test(v), 'Tiene que empezar con https://')
  .refine(v => !/[\u0000-\u001F\u007F]/.test(v), 'El link no puede tener saltos de línea')
  .max(500, 'El link es demasiado largo')
  .optional()
  .or(z.literal(''))

export const profileSettingsSchema = z.object({
  name: nameField,
  bio: bioField,
  profileImageUrl: optionalUrlField,
  logoUrl: optionalUrlField,
  whatsapp: optionalStringField,
  instagram: optionalStringField,
  addressText: optionalStringField,
  city: cityField,
  subdomain: subdomainField,
})

export const reservationSettingsSchema = z.object({
  timezone: timezoneField,
  slotStepMinutes: slotStepField,
  manualHoldHours: manualHoldField,
  requireBookingApproval: z.boolean().default(false),
  defaultMeetingUrl: meetingUrlField,
})

export const policySettingsSchema = z.object({
  selfServiceCutoffHours: cutoffField,
  cancellationReminderEnabled: z.boolean().default(true),
  cancellationPolicy: optionalStringField,
  bookingPolicy: optionalStringField,
  depositPolicy: optionalStringField,
})

// Temporalmente conservamos este contrato para los callers que aún no migran
// a las tres acciones acotadas. Task 8 retira el monolito.
export const updateBusinessSchema = profileSettingsSchema
  .merge(reservationSettingsSchema)
  .merge(policySettingsSchema)

export type ProfileSettingsInput = z.input<typeof profileSettingsSchema>
export type ReservationSettingsInput = z.input<typeof reservationSettingsSchema>
export type PolicySettingsInput = z.input<typeof policySettingsSchema>
export type UpdateBusinessInput = z.input<typeof updateBusinessSchema>
export type UpdateBusinessOutput = z.output<typeof updateBusinessSchema>

/** Valor del form → minutos para Business.slotStepMinutes (null = duración del servicio). */
export function slotStepToMinutes(value: UpdateBusinessOutput['slotStepMinutes']): number | null {
  return value === 'service' ? null : Number(value)
}
