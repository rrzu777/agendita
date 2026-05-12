import { redirect } from 'next/navigation'
import { DashboardHeader } from '@/components/dashboard/header'
import { AvailabilityEditor } from '@/components/dashboard/availability-editor'
import { TimeBlockForm, TimeBlockList } from '@/components/dashboard/time-block-form'
import { getAvailabilityRules } from '@/server/actions/availability'
import { getTimeBlocks } from '@/server/actions/time-blocks'
import { getCurrentUserWithBusiness } from '@/lib/auth/user'

export default async function AvailabilityPage() {
  const userData = await getCurrentUserWithBusiness()

  if (!userData?.business) {
    redirect('/login')
  }

  const rules = await getAvailabilityRules(userData.business.id)
  const blocks = await getTimeBlocks(userData.business.id)

  return (
    <div>
      <DashboardHeader title="Horarios de atención" subtitle="Define cuándo atiendes y bloquea días específicos." />
      <div className="max-w-4xl space-y-10 p-5 md:p-10">
        <section className="studio-card p-6">
          <h2 className="mb-2 text-2xl font-semibold tracking-normal text-primary">Horario semanal</h2>
          <p className="mb-6 text-muted-foreground">
            Configura tus horarios de atención por día de la semana.
          </p>
          <AvailabilityEditor rules={rules} />
        </section>

        <section className="studio-card p-6">
          <div className="mb-3 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="text-2xl font-semibold tracking-normal text-primary">Bloqueos</h2>
            <TimeBlockForm businessId={userData.business.id} />
          </div>
          <p className="mb-5 text-muted-foreground">
            Bloquea días o horarios específicos cuando no puedas atender.
          </p>
          <TimeBlockList blocks={blocks} />
        </section>
      </div>
    </div>
  )
}
