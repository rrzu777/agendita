'use server'

import { prisma } from '@/lib/db'
import { revalidatePath } from 'next/cache'
import { checkRateLimit } from '@/lib/rate-limit'
import { requireBusinessRole } from '@/lib/auth/server'
import { bankTransferAccountSchema, type BankTransferAccountInput } from '@/lib/bank-transfer/schema'

// NOTE: módulo 'use server' — SOLO funciones async exportadas. El schema Zod y
// los tipos viven en '@/lib/bank-transfer/schema'; re-exportarlos acá revienta
// en runtime (ver business-settings.ts:15-20).

export async function saveBankTransferAccount(data: BankTransferAccountInput) {
  const { businessId } = await requireBusinessRole(['owner', 'admin'])

  const limit = await checkRateLimit('save-bank-transfer-account', 20, 60000)
  if (!limit.success) {
    throw new Error('Demasiadas solicitudes. Intenta de nuevo en unos minutos.')
  }

  const parsed = bankTransferAccountSchema.safeParse(data)
  if (!parsed.success) {
    throw new Error('Datos inválidos: ' + parsed.error.issues.map(i => i.message).join(', '))
  }
  const v = parsed.data

  // El schema ya trimea; acá solo queda normalizar ''/undefined → null.
  const fields = { ...v, email: v.email || null, instructions: v.instructions || null }

  await prisma.bankTransferAccount.upsert({
    where: { businessId },
    create: { businessId, ...fields },
    update: fields,
  })

  revalidatePath('/dashboard/settings/payments')
}

export async function setBankTransferEnabled(isEnabled: boolean) {
  const { businessId } = await requireBusinessRole(['owner', 'admin'])

  const limit = await checkRateLimit('set-bank-transfer-enabled', 20, 60000)
  if (!limit.success) {
    throw new Error('Demasiadas solicitudes. Intenta de nuevo en unos minutos.')
  }

  const { count } = await prisma.bankTransferAccount.updateMany({ where: { businessId }, data: { isEnabled } })
  if (count === 0) {
    throw new Error('Primero guardá los datos de la cuenta bancaria.')
  }
  revalidatePath('/dashboard/settings/payments')
}
