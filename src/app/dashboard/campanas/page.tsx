import { redirect } from 'next/navigation'
import { DashboardHeader } from '@/components/dashboard/header'
import { getCurrentUserWithBusiness } from '@/lib/auth/user'
import { getCampaigns, listCampaignPromotions } from '@/server/actions/campaigns'
import { getServices } from '@/server/actions/services'
import { CampaignList } from './campaign-list'
import { NewCampaignDialog } from './new-campaign-dialog'

type Campaign = Awaited<ReturnType<typeof getCampaigns>>[number]
type CampaignPromotion = Awaited<ReturnType<typeof listCampaignPromotions>>[number]

export default async function CampanasPage() {
  const userData = await getCurrentUserWithBusiness()

  if (!userData?.user) {
    redirect('/login')
  }

  if (!userData?.business) {
    redirect('/recover-business')
  }

  const currency = userData.business.currency

  let campaigns: Campaign[] = []
  let promotions: CampaignPromotion[] = []
  let services: Awaited<ReturnType<typeof getServices>> = []

  try {
    campaigns = await getCampaigns()
    promotions = await listCampaignPromotions()
    services = await getServices()
  } catch {
    // Auth error fallback
  }

  const promotionOptions = promotions.map((p) => ({ id: p.id, name: p.name }))
  const serviceOptions = services.map((s) => ({ id: s.id, name: s.name }))

  return (
    <div>
      <DashboardHeader
        title="Campañas"
        subtitle="Enviá promos por WhatsApp a un grupo de clientas."
      />
      <div className="p-5 md:p-10">
        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="font-heading text-2xl font-semibold tracking-tight text-primary">Tus campañas</h2>
            <p className="text-sm text-muted-foreground">Segmentá clientas y regalales un beneficio.</p>
          </div>
          <NewCampaignDialog promotions={promotionOptions} services={serviceOptions} currency={currency} />
        </div>

        <CampaignList campaigns={campaigns} />
      </div>
    </div>
  )
}
