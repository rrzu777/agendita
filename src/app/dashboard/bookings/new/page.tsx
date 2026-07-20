import { redirect } from 'next/navigation'
import { DashboardHeader } from '@/components/dashboard/header'
import { NewBookingForm } from './new-booking-form'
import { getCurrentUserWithBusiness } from '@/lib/auth/user'
import { prisma } from '@/lib/db'

export default async function NewBookingPage() {
  const userData = await getCurrentUserWithBusiness()

  if (!userData?.user) {
    redirect('/login')
  }

  if (!userData?.business) {
    redirect('/recover-business')
  }

  const services = await prisma.service.findMany({
    where: { businessId: userData.business.id, isActive: true },
    orderBy: { sortOrder: 'asc' },
  })

  return (
    <div>
      <DashboardHeader title="Nueva reserva" subtitle="Crea una reserva manual para tus clientes" />
      <div className="p-5 md:p-10">
        <NewBookingForm services={services} businessId={userData.business.id} timezone={userData.business.timezone || 'America/Santiago'} currency={userData.business.currency || 'CLP'} />
      </div>
    </div>
  )
}
