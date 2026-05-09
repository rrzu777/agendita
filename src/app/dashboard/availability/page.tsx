import { DashboardHeader } from '@/components/dashboard/header'
import { AvailabilityEditor } from '@/components/dashboard/availability-editor'
import { TimeBlockForm, TimeBlockList } from '@/components/dashboard/time-block-form'
import { getAvailabilityRules } from '@/server/actions/availability'
import { getTimeBlocks } from '@/server/actions/time-blocks'

export default async function AvailabilityPage() {
  const rules = await getAvailabilityRules()
  const blocks = await getTimeBlocks()

  return (
    <div>
      <DashboardHeader title="Horarios de atención" />
      <div className="p-8 max-w-2xl space-y-10">
        <section>
          <h2 className="text-lg font-semibold mb-4">Horario semanal</h2>
          <p className="text-gray-600 mb-6">
            Configura tus horarios de atención por día de la semana.
          </p>
          <AvailabilityEditor rules={rules} />
        </section>

        <section>
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-lg font-semibold">Bloqueos</h2>
            <TimeBlockForm />
          </div>
          <p className="text-gray-600 mb-4">
            Bloquea días o horarios específicos cuando no puedas atender.
          </p>
          <TimeBlockList blocks={blocks} />
        </section>
      </div>
    </div>
  )
}
