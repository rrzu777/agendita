export const dynamic = 'force-dynamic'

import { BookingWizard } from '@/components/booking/wizard'
import { prisma } from '@/lib/db'
import { notFound } from 'next/navigation'
import { unstable_cache } from 'next/cache'

interface BookPageProps {
  params: Promise<{ slug: string }>
}

const getBookingBusiness = unstable_cache(async (slug: string) => {
  return prisma.business.findUnique({
    relationLoadStrategy: 'join',
    where: { slug },
    include: {
      services: {
        where: { isActive: true },
        orderBy: { sortOrder: 'asc' },
      },
    },
  })
}, ['booking-business'], { revalidate: 60, tags: ['booking-business'] })

export default async function BookPage({ params }: BookPageProps) {
  const { slug } = await params

  const business = await getBookingBusiness(slug)

  if (!business || !business.isActive) {
    notFound()
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-2xl mx-auto px-4">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-gray-900">{business.name}</h1>
          <p className="text-gray-600">Reserva tu hora</p>
        </div>
        <BookingWizard 
          businessId={business.id} 
          services={business.services}
        />
      </div>
    </div>
  )
}
