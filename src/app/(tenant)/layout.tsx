import { prisma } from '@/lib/db/prisma'
import { headers } from 'next/headers'
import { notFound } from 'next/navigation'

async function getBusiness(subdomain: string) {
  const business = await prisma.business.findUnique({
    where: { subdomain },
    include: {
      services: {
        where: { isActive: true },
        orderBy: { sortOrder: 'asc' },
      },
      galleryImages: {
        orderBy: { sortOrder: 'asc' },
      },
      reviews: {
        where: { isApproved: true },
        orderBy: { createdAt: 'desc' },
        take: 10,
        include: { customer: { select: { name: true } } },
      },
    },
  })
  
  return business
}

export default async function TenantLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const headersList = headers()
  const subdomain = headersList.get('x-business-subdomain')
  
  if (!subdomain) {
    notFound()
  }
  
  const business = await getBusiness(subdomain)
  
  if (!business) {
    notFound()
  }
  
  return (
    <div className="min-h-screen bg-white">
      {children}
    </div>
  )
}
