'use server'

import { prisma } from '@/lib/db'
import { BANK_TRANSFER_PUBLIC_SELECT, type BankTransferPublicInfo } from '@/lib/bank-transfer/public-info'

// NOTE: módulo 'use server' — SOLO funciones async exportadas (schemas/consts
// en src/lib/bank-transfer/). Flujo PÚBLICO: sin sesión, mismo modelo de
// seguridad que payments.ts (identidad = bookingId cuid + rate limit).

export async function getBankTransferInfo(businessId: string): Promise<BankTransferPublicInfo | null> {
  const account = await prisma.bankTransferAccount.findUnique({
    where: { businessId },
    select: { ...BANK_TRANSFER_PUBLIC_SELECT, isEnabled: true },
  })
  if (!account || !account.isEnabled) return null
  const { isEnabled: _isEnabled, ...publicInfo } = account
  return publicInfo
}
