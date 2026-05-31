import { redirect, notFound } from 'next/navigation'
import { DashboardHeader } from '@/components/dashboard/header'
import { getCurrentUserWithBusiness } from '@/lib/auth/user'
import { prisma } from '@/lib/db'
import { RescheduleForm } from './reschedule-form'
import { formatInTimeZone } from 'date-fns-tz'

interface ReschedulePageProps {
  params: Promise<{ id: string }>
}

export default async function ReschedulePage({ params }: ReschedulePageProps) {
  const userData = await getCurrentUserWithBusiness()
  const { id } = await params

  if (!userData?.user) {
    redirect('/login')
  }

  if (!userData?.business) {
    redirect('/recover-business')
  }

  const booking = await prisma.booking.findFirst({
    where: { id, businessId: userData.business.id },
    include: { service: true, customer: true },
  })

  if (!booking) {
    notFound()
  }

  if (['completed', 'cancelled', 'no_show', 'expired'].includes(booking.status)) {
    redirect(`/dashboard/bookings`)
  }

  const timezone = userData.business.timezone || 'America/Santiago'

  return (
    <div>
      <DashboardHeader title="Reprogramar reserva" subtitle={booking.service?.name || 'Servicio'} />
      <div className="p-5 md:p-10">
        <RescheduleForm
          bookingId={booking.id}
          customerName={booking.customer?.name || ''}
          serviceName={booking.service?.name || ''}
          currentDate={formatInTimeZone(booking.startDateTime, timezone, 'yyyy-MM-dd')}
          currentTime={formatInTimeZone(booking.startDateTime, timezone, 'HH:mm')}
          timezone={timezone}
        />
      </div>
    </div>
  )
}
