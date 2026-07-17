'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/db'
import { checkRateLimit } from '@/lib/rate-limit'
import { requireUser, ForbiddenError } from '@/lib/auth/server'
import { resolveLoyaltyCustomer } from '@/lib/loyalty/token'
import { setMarketingOptOut } from '@/lib/campaigns/optout'

/** Baja/re-alta autogestionada desde la tarjeta pública. El token es la credencial
 *  (misma confianza que ver puntos / canjear). Esta MISMA action es la que reusará
 *  el link de unsubscribe de C-email — no crear una segunda mecánica de baja. */
export async function setMarketingOptOutByToken(token: string, optedOut: boolean) {
  if (typeof optedOut !== 'boolean') throw new Error('Datos inválidos')
  const customer = await resolveLoyaltyCustomer(prisma, token)
  if (!customer) throw new ForbiddenError('Tarjeta no disponible')
  const limit = await checkRateLimit('optout-public', 10, 60000, { businessId: customer.businessId, userId: customer.id })
  if (!limit.success) throw new Error('Demasiadas solicitudes. Intenta más tarde.')
  await setMarketingOptOut(prisma, customer.id, optedOut)
  revalidatePath(`/tarjeta/${token}`)
}

/** Baja/re-alta autogestionada desde /mi (sesión). Ownership: el Customer debe
 *  estar vinculado a esta cuenta (patrón redeemPointsAsMe). */
export async function setMarketingOptOutAsMe(customerId: string, optedOut: boolean) {
  if (typeof optedOut !== 'boolean') throw new Error('Datos inválidos')
  const user = await requireUser()
  const customer = await prisma.customer.findFirst({
    where: { id: customerId, userId: user.id },
    select: { id: true, businessId: true, loyaltyToken: true, business: { select: { slug: true } } },
  })
  if (!customer) throw new ForbiddenError('No encontrada')
  // Mismo bucket que la vía por token (keyed por customer.id): alternar superficies
  // no debe duplicar el cupo.
  const limit = await checkRateLimit('optout-public', 10, 60000, { businessId: customer.businessId, userId: customer.id })
  if (!limit.success) throw new Error('Demasiadas solicitudes. Intenta más tarde.')
  await setMarketingOptOut(prisma, customer.id, optedOut)
  revalidatePath(`/mi/${customer.business.slug}`)
  if (customer.loyaltyToken) {
    revalidatePath(`/tarjeta/${customer.loyaltyToken}`)
  }
}
