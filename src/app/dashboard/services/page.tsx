import { DashboardCatalogueNav } from '@/components/dashboard/dashboard-catalogue-nav'
import { getVocabulary } from '@/lib/vocabulary'
import { redirect } from 'next/navigation'
import { DashboardHeader } from '@/components/dashboard/header'
import { ServiceTable } from '@/components/dashboard/service-table'
import { getServices } from '@/server/actions/services'
import { getCurrentUserWithBusiness } from '@/lib/auth/user'
import { getColorFavorites } from '@/server/actions/color-favorites'
import { ColorFavoritesProvider } from '@/components/dashboard/color-favorites-provider'

export const metadata = { title: 'Servicios — Agendita' }

export default async function ServicesPage() {
  const userData = await getCurrentUserWithBusiness()

  if (!userData?.user) {
    redirect('/login')
  }

  if (!userData?.business) {
    redirect('/recover-business')
  }

  const services = await getServices(true)
  const favorites = await getColorFavorites()

  return (
    <div>
      <DashboardHeader
        title="Servicios"
        subtitle="Gestiona tus servicios y precios."
      />
      <div className="mx-auto max-w-[1420px] p-4 min-[1100px]:p-10">
        <DashboardCatalogueNav vocabulary={getVocabulary(userData.business.category)} role={userData.role ?? 'staff'} />
        <ColorFavoritesProvider initialFavorites={favorites} canManage={userData.role === 'owner' || userData.role === 'admin'}>
          <ServiceTable services={services} currency={userData.business.currency || 'CLP'} />
        </ColorFavoritesProvider>
      </div>
    </div>
  )
}
