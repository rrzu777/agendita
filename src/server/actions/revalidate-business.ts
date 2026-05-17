import { revalidatePath, revalidateTag } from 'next/cache'
import { prisma } from '@/lib/db'

export async function revalidateBusinessPublicPaths(businessId: string) {
  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: { slug: true },
  })

  if (!business) return

  revalidateTag('public-business', 'max')
  revalidateTag('booking-business', 'max')
  revalidatePath('/')
  revalidatePath('/book')
  revalidatePath(`/b/${business.slug}`)
  revalidatePath(`/book/${business.slug}`)
}
