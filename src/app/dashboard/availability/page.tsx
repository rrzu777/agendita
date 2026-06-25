import { redirect } from 'next/navigation'
import { DashboardHeader } from '@/components/dashboard/header'
import { AvailabilityEditor } from '@/components/dashboard/availability-editor'
import { TimeBlockForm, TimeBlockList } from '@/components/dashboard/time-block-form'
import { getAvailabilityRules } from '@/server/actions/availability'
import { getTimeBlocks } from '@/server/actions/time-blocks'
import { getCurrentUserWithBusiness } from '@/lib/auth/user'

export default async function AvailabilityPage() {
  const userData = await getCurrentUserWithBusiness()

  if (!userData?.user) {
    redirect('/login')
  }

  if (!userData?.business) {
    redirect('/recover-business')
  }

  const rules = await getAvailabilityRules()
  const blocks = await getTimeBlocks()

  return (
    <div>
      <DashboardHeader title="Disponibilidad" subtitle="Configura tus horarios de atención y bloqueos." />
      <div className="space-y-8 p-5 md:p-10">
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-heading font-semibold tracking-tight text-primary">Horario semanal</h2>
              <p className="text-sm text-muted-foreground">Define los días y horas en que atiendes.</p>
            </div>
          </div>
          <AvailabilityEditor rules={rules} />
        </div>

        <div className="space-y-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-2xl font-heading font-semibold tracking-tight text-primary">Bloqueos</h2>
              <p className="text-sm text-muted-foreground">Marca días o rangos en los que no estarás disponible.</p>
            </div>
            <TimeBlockForm />
          </div>
          <TimeBlockList blocks={blocks} />
        </div>
      </div>
    </div>
  )
}
