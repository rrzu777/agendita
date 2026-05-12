import { BookingWizard } from '@/components/booking/wizard'
import { prisma } from '@/lib/db'
import { notFound } from 'next/navigation'

interface BookPageProps {
  params: Promise<{ slug: string }>
}

export default async function BookPage({ params }: BookPageProps) {
  const { slug } = await params

  const business = await prisma.business.findUnique({
    where: { slug },
    include: {
      services: {
        where: { isActive: true },
        orderBy: { sortOrder: 'asc' },
      },
      availability: {
        where: { isActive: true },
        orderBy: { dayOfWeek: 'asc' },
      },
      timeBlocks: {
        where: {
          endDateTime: { gte: new Date() },
        },
        orderBy: { startDateTime: 'asc' },
      },
      bookings: {
        where: {
          status: { notIn: ['cancelled', 'no_show'] },
          startDateTime: { gte: new Date() },
        },
        orderBy: { startDateTime: 'asc' },
      },
    },
  })

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
          availabilityRules={business.availability}
          timeBlocks={business.timeBlocks}
          bookings={business.bookings}
        />
      </div>
    </div>
  )
}
