import { redirect } from 'next/navigation'
import { DashboardHeader } from '@/components/dashboard/header'
import { getCurrentUserWithBusiness } from '@/lib/auth/user'
import { getLoyaltyConfig } from '@/server/actions/loyalty'
import { LoyaltyConfigForm } from './loyalty-config-form'

export default async function FidelizacionPage() {
  const userData = await getCurrentUserWithBusiness()

  if (!userData?.user) {
    redirect('/login')
  }

  if (!userData?.business) {
    redirect('/recover-business')
  }

  const config = await getLoyaltyConfig()

  return (
    <div>
      <DashboardHeader
        title="Fidelización"
        subtitle="Programa de puntos para tus clientas."
      />
      <div className="p-5 md:p-10">
        <div className="mx-auto max-w-2xl">
          <LoyaltyConfigForm config={config} />
        </div>
      </div>
    </div>
  )
}
