import { redirect } from 'next/navigation'
import { DashboardHeader } from '@/components/dashboard/header'
import { NewBookingForm } from './new-booking-form'
import { getCurrentUserWithBusiness } from '@/lib/auth/user'
import { prisma } from '@/lib/db'
import { funnelProfessionalsQueryFor, toFunnelProfessionals } from '@/lib/professionals/eligible'
import { getVocabulary } from '@/lib/vocabulary'

export default async function NewBookingPage({
  searchParams,
}: {
  searchParams: Promise<{ customerId?: string | string[] }>
}) {
  const userData = await getCurrentUserWithBusiness()

  if (!userData?.user) {
    redirect('/login')
  }

  if (!userData?.business) {
    redirect('/recover-business')
  }

  const customerId = (await searchParams).customerId
  const selectedCustomerId = typeof customerId === 'string' ? customerId : null

  const [services, team, initialCustomer] = await Promise.all([
    prisma.service.findMany({
      where: { businessId: userData.business.id, isActive: true },
      orderBy: { sortOrder: 'asc' },
    }),
    // El MISMO equipo que ve el funnel público.
    prisma.professional.findMany(funnelProfessionalsQueryFor(userData.business.id)),
    selectedCustomerId
      ? prisma.customer.findFirst({
          where: { id: selectedCustomerId, businessId: userData.business.id },
          select: { id: true, name: true, phone: true, email: true },
        })
      : Promise.resolve(null),
  ])

  return (
    <div>
      <DashboardHeader title="Nueva reserva" subtitle={`Crea una reserva manual para tus ${getVocabulary(userData.business.category).clients}`} />
      <div className="p-5 md:p-10">
        <NewBookingForm
          services={services}
          professionals={toFunnelProfessionals(team)}
          businessId={userData.business.id}
          timezone={userData.business.timezone || 'America/Santiago'}
          currency={userData.business.currency || 'CLP'}
          initialCustomer={initialCustomer}
        />
      </div>
    </div>
  )
}
