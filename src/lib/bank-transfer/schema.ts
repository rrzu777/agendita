import { z } from 'zod'

// Módulo aparte a propósito: el archivo de server actions ('use server') solo
// puede exportar funciones async — ver business-settings.ts:15-20.
export const bankTransferAccountSchema = z.object({
  accountHolder: z.string().trim().min(1, 'El titular es obligatorio').max(120),
  rut: z.string().trim().min(1, 'El RUT es obligatorio').max(20),
  bankName: z.string().trim().min(1, 'El banco es obligatorio').max(80),
  accountType: z.string().trim().min(1, 'El tipo de cuenta es obligatorio').max(40),
  accountNumber: z.string().trim().min(1, 'El número de cuenta es obligatorio').max(40),
  email: z.string().trim().email('Email inválido').max(120).or(z.literal('')).optional(),
  instructions: z.string().trim().max(500).optional(),
  holdHours: z.coerce.number().int().min(1, 'Mínimo 1 hora').max(168, 'Máximo 168 horas (7 días)'),
  verifyHours: z.coerce.number().int().min(1, 'Mínimo 1 hora').max(720, 'Máximo 720 horas (30 días)').nullable(),
})

export type BankTransferAccountInput = z.infer<typeof bankTransferAccountSchema>
