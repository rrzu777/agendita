import { DashboardCatalogueNav } from '@/components/dashboard/dashboard-catalogue-nav'
import { redirect } from 'next/navigation'
import { DashboardHeader } from '@/components/dashboard/header'
import { ProfessionalTable } from '@/components/dashboard/professional-table'
import { getProfessionals, getAssignableServices } from '@/server/actions/professionals'
import { getCurrentUserWithBusiness } from '@/lib/auth/user'
import { getVocabulary } from '@/lib/vocabulary'

export const metadata = { title: 'Equipo — Agendita' }

export default async function EquipoPage() {
  const userData = await getCurrentUserWithBusiness()

  if (!userData?.user) {
    redirect('/login')
  }

  if (!userData?.business) {
    redirect('/recover-business')
  }

  const [professionals, services] = await Promise.all([
    getProfessionals(true),
    getAssignableServices(),
  ])
  const v = getVocabulary(userData.business.category)

  return (
    <div>
      <DashboardHeader
        title={v.Professionals}
        subtitle="Quién trabaja en tu negocio y qué servicios hace cada persona."
      />
      <div className="mx-auto max-w-[1420px] p-4 min-[1100px]:p-10">
        <DashboardCatalogueNav vocabulary={getVocabulary(userData.business.category)} role={userData.role ?? 'staff'} />
        <ProfessionalTable
          professionals={professionals.map((p) => ({
            id: p.id,
            name: p.name,
            bio: p.bio,
            isActive: p.isActive,
            sortOrder: p.sortOrder,
            modalities: p.modalities,
            serviceIds: p.services.map((s) => s.id),
          }))}
          services={services}
        />
      </div>
    </div>
  )
}
