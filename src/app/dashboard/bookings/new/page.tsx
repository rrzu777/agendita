import { redirect } from 'next/navigation'
import { DashboardHeader } from '@/components/dashboard/header'
import { NewBookingForm } from './new-booking-form'
import { getCurrentUserWithBusiness } from '@/lib/auth/user'
import { prisma } from '@/lib/db'

export default async function NewBookingPage() {
  const userData = await getCurrentUserWithBusiness()

  if (!userData?.business) {
    redirect('/login')
  }

  const services = await prisma.service.findMany({
    where: { businessId: userData.business.id, isActive: true },
    orderBy: { sortOrder: 'asc' },
  })

  return (
    <div>
      <DashboardHeader title="Nueva reserva" subtitle="Crea una reserva manual para tus clientas" />
      <div className="p-5 md:p-10">
        <NewBookingForm businessId={userData.business.id} services={services} />
      </div>
    </div>
  )
}
