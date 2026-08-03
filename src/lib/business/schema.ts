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
  // Hasta cuántas horas antes de la cita una clienta puede autogestionar
  // (cancelar/reprogramar) su reserva desde /mi. 0 = sin límite.
  // El input vacío ('') vuelve al default 24: Number('') === 0 y 0 significa
  // "sin límite" — un campo borrado por accidente no debe abrir la ventana.
  selfServiceCutoffHours: z.preprocess(
    (v) => (v === '' || v == null ? undefined : v),
    z.coerce.number().int().min(0).max(720).default(24),
  ),
  // Cuántas horas se le guarda el horario a una reserva cuando el negocio
  // coordina el abono a mano (sin pago online ni transferencia). Mínimo 1: un
  // hold de 0 horas nacería vencido. Vacío → default 24, mismo criterio que
  // arriba: un campo borrado por accidente no debe achicar la ventana.
  manualHoldHours: z.preprocess(
    (v) => (v === '' || v == null ? undefined : v),
    z.coerce.number().int().min(1).max(720).default(24),
  ),
  // Confirmación manual: las reservas sin abono quedan esperando que el negocio
  // las acepte en vez de confirmarse solas.
  requireBookingApproval: z.boolean().default(false),
  // Sala fija de videollamada para los servicios online. URL completa: se manda
  // tal cual por email, así que un "meet.google.com/xxx" sin esquema no serviría
  // como link clickeable.
  //
  // El esquema se exige explícitamente: `.url()` de Zod acepta CUALQUIER esquema
  // que el parser de URL entienda, incluido `javascript:`, y este valor termina
  // como href en pantallas públicas. Sin este refine, la dueña de un negocio
  // puede guardar un XSS que se ejecuta en el navegador de sus clientas.
  defaultMeetingUrl: z
    .string()
    .trim()
    .url('Tiene que ser un link completo, con https://')
    .refine((v) => /^https?:\/\//i.test(v), 'Tiene que empezar con https://')
    // Sin caracteres de control: `.url()` los deja pasar (el parser de URL los
    // ignora, pero el valor guardado los conserva) y el `.ics` de la reserva
    // escribe este link crudo en una línea propia, donde un salto la parte.
    .refine((v) => !/[\u0000-\u001F\u007F]/.test(v), 'El link no puede tener saltos de línea')
    .max(500, 'El link es demasiado largo')
    .optional()
    .or(z.literal('')),
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
