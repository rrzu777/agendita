'use server'

import { prisma } from '@/lib/db'
import { revalidatePath, revalidateTag } from 'next/cache'
import { checkRateLimit } from '@/lib/rate-limit'
import { revalidateBusinessPublicPaths } from './revalidate-business'
import { requireBusinessRole } from '@/lib/auth/server'
import { updateBusinessSchema, type UpdateBusinessInput } from '@/lib/business/schema'
import { normalizeWhatsapp, normalizeInstagram } from '@/lib/business/normalize'

const RESERVED_SUBDOMAINS = [
  'www', 'app', 'admin', 'dashboard', 'api', 'login', 'register', 'support',
]

export { updateBusinessSchema }
export type { UpdateBusinessInput }

function trimToNull(value: string | undefined): string | null {
  if (value === undefined || value.trim() === '') return null
  return value.trim()
}

export async function updateBusinessSettings(data: UpdateBusinessInput) {
  const { businessId } = await requireBusinessRole(['owner', 'admin'])

  const limit = await checkRateLimit('update-business-settings', 20, 60000)
  if (!limit.success) {
    throw new Error('Demasiadas solicitudes. Intenta de nuevo en unos minutos.')
  }

  const parsed = updateBusinessSchema.safeParse(data)
  if (!parsed.success) {
    throw new Error('Datos inválidos: ' + parsed.error.issues.map(i => i.message).join(', '))
  }

  const validated = parsed.data

  if (RESERVED_SUBDOMAINS.includes(validated.subdomain)) {
    throw new Error('Este subdominio está reservado')
  }

  const existing = await prisma.business.findFirst({
    where: {
      subdomain: validated.subdomain,
      NOT: { id: businessId },
    },
  })
  if (existing) {
    throw new Error('Este subdominio ya está en uso')
  }

  const updateData = {
    name: validated.name.trim(),
    bio: trimToNull(validated.bio),
    profileImageUrl: trimToNull(validated.profileImageUrl),
    logoUrl: trimToNull(validated.logoUrl),
    whatsapp: normalizeWhatsapp(validated.whatsapp) || null,
    instagram: normalizeInstagram(validated.instagram) || null,
    addressText: trimToNull(validated.addressText),
    city: validated.city.trim(),
    timezone: validated.timezone,
    subdomain: validated.subdomain,
    cancellationPolicy: trimToNull(validated.cancellationPolicy),
    bookingPolicy: trimToNull(validated.bookingPolicy),
    depositPolicy: trimToNull(validated.depositPolicy),
  }

  const updated = await prisma.business.update({
    where: { id: businessId },
    data: updateData,
  })

  revalidatePath('/dashboard/settings')
  revalidateTag('public-business', 'max')
  await revalidateBusinessPublicPaths(businessId)

  return updated
}
