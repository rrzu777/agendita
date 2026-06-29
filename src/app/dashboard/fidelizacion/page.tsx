import { redirect } from 'next/navigation'
import { DashboardHeader } from '@/components/dashboard/header'
import { getCurrentUserWithBusiness } from '@/lib/auth/user'
import { getLoyaltyConfig, listRedemptionOptions } from '@/server/actions/loyalty'
import { getServices } from '@/server/actions/services'
import { LoyaltyConfigForm } from './loyalty-config-form'
import { RedemptionCatalog } from './redemption-catalog'

export default async function FidelizacionPage() {
  const userData = await getCurrentUserWithBusiness()

  if (!userData?.user) {
    redirect('/login')
  }

  if (!userData?.business) {
    redirect('/recover-business')
  }

  const [config, options, services] = await Promise.all([
    getLoyaltyConfig(),
    listRedemptionOptions(),
    getServices(),
  ])

  return (
    <div>
      <DashboardHeader
        title="Fidelización"
        subtitle="Programa de puntos para tus clientas."
      />
      <div className="p-5 md:p-10">
        <div className="mx-auto max-w-2xl">
          <LoyaltyConfigForm config={config} />
          <RedemptionCatalog options={options} services={services} />
        </div>
      </div>
    </div>
  )
}
