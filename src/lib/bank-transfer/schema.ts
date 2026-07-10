import { z } from 'zod'

// Módulo aparte a propósito: el archivo de server actions ('use server') solo
// puede exportar funciones async — ver business-settings.ts:15-20.

// Única fuente de los límites/defaults de las ventanas: el form los usa en
// min/max HTML y como valores iniciales; deben coincidir con los @default
// del modelo Prisma.
export const HOLD_HOURS_MAX = 168
export const VERIFY_HOURS_MAX = 720
export const DEFAULT_HOLD_HOURS = 24
export const DEFAULT_VERIFY_HOURS = 48

export const bankTransferAccountSchema = z.object({
  accountHolder: z.string().trim().min(1, 'El titular es obligatorio').max(120),
  rut: z.string().trim().min(1, 'El RUT es obligatorio').max(20),
  bankName: z.string().trim().min(1, 'El banco es obligatorio').max(80),
  accountType: z.string().trim().min(1, 'El tipo de cuenta es obligatorio').max(40),
  accountNumber: z.string().trim().min(1, 'El número de cuenta es obligatorio').max(40),
  email: z.string().trim().email('Email inválido').max(120).or(z.literal('')).optional(),
  instructions: z.string().trim().max(500).optional(),
  holdHours: z.coerce.number().int().min(1, 'Mínimo 1 hora').max(HOLD_HOURS_MAX, `Máximo ${HOLD_HOURS_MAX} horas (7 días)`),
  verifyHours: z.coerce.number().int().min(1, 'Mínimo 1 hora').max(VERIFY_HOURS_MAX, `Máximo ${VERIFY_HOURS_MAX} horas (30 días)`).nullable(),
})

export type BankTransferAccountInput = z.infer<typeof bankTransferAccountSchema>
