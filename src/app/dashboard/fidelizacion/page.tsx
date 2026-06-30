import { redirect } from 'next/navigation'
import { DashboardHeader } from '@/components/dashboard/header'
import { getCurrentUserWithBusiness } from '@/lib/auth/user'
import { getLoyaltyConfig, listRedemptionOptions, listAutomaticRules } from '@/server/actions/loyalty'
import { getServices } from '@/server/actions/services'
import { LoyaltyConfigForm } from './loyalty-config-form'
import { RedemptionCatalog } from './redemption-catalog'
import { AutomaticRules } from './automatic-rules'

export default async function FidelizacionPage() {
  const userData = await getCurrentUserWithBusiness()

  if (!userData?.user) {
    redirect('/login')
  }

  if (!userData?.business) {
    redirect('/recover-business')
  }

  const [config, options, services, rules] = await Promise.all([
    getLoyaltyConfig(),
    listRedemptionOptions(),
    getServices(),
    listAutomaticRules(),
  ])

  const currency = userData.business.currency
  const pointsLabel = config?.pointsLabel ?? 'puntos'

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
          <AutomaticRules
            rules={rules}
            services={services}
            pointsLabel={pointsLabel}
            currency={currency}
          />
        </div>
      </div>
    </div>
  )
}
