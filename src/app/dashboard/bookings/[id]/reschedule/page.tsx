import { redirect, notFound } from 'next/navigation'
import { DashboardHeader } from '@/components/dashboard/header'
import { getCurrentUserWithBusiness } from '@/lib/auth/user'
import { prisma } from '@/lib/db'
import { RescheduleForm } from './reschedule-form'

interface ReschedulePageProps {
  params: Promise<{ id: string }>
}

export default async function ReschedulePage({ params }: ReschedulePageProps) {
  const userData = await getCurrentUserWithBusiness()
  const { id } = await params

  if (!userData?.business) {
    redirect('/login')
  }

  const booking = await prisma.booking.findFirst({
    where: { id, businessId: userData.business.id },
    include: { service: true, customer: true },
  })

  if (!booking) {
    notFound()
  }

  if (booking.status === 'completed' || booking.status === 'cancelled') {
    redirect(`/dashboard/bookings`)
  }

  return (
    <div>
      <DashboardHeader title="Reprogramar reserva" subtitle={booking.service?.name || 'Servicio'} />
      <div className="p-5 md:p-10">
        <RescheduleForm
          bookingId={booking.id}
          customerName={booking.customer?.name || ''}
          serviceName={booking.service?.name || ''}
          currentDate={booking.startDateTime.toISOString().split('T')[0]}
          currentTime={booking.startDateTime.toTimeString().slice(0, 5)}
          businessId={userData.business.id}
        />
      </div>
    </div>
  )
}
