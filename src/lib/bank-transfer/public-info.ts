import type { Prisma } from '@prisma/client'

// Campos de BankTransferAccount que SÍ se exponen al flujo público (decisión 7
// del spec: visibles para cualquiera que elija transferir). isEnabled/verifyHours
// se quedan server-side.
export const BANK_TRANSFER_PUBLIC_SELECT = {
  accountHolder: true,
  rut: true,
  bankName: true,
  accountType: true,
  accountNumber: true,
  email: true,
  instructions: true,
  holdHours: true,
} satisfies Prisma.BankTransferAccountSelect

export type BankTransferPublicInfo = Prisma.BankTransferAccountGetPayload<{
  select: typeof BANK_TRANSFER_PUBLIC_SELECT
}>
