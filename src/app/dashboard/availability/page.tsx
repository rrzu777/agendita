import { redirect } from 'next/navigation'
import { addDays } from 'date-fns'
import { DashboardHeader } from '@/components/dashboard/header'
import { AvailabilityEditor } from '@/components/dashboard/availability-editor'
import { TimeBlockList } from '@/components/dashboard/time-block-form'
import { BlockTimeModal } from '@/components/dashboard/block-time-modal'
import { ServiceFitWarnings } from '@/components/dashboard/service-fit-warnings'
import { getAvailabilityRules } from '@/server/actions/availability'
import { getServices } from '@/server/actions/services'
import { getTimeBlocks, getTimeBlockSeries } from '@/server/actions/time-blocks'
import { RecurringBlockList } from '@/components/dashboard/recurring-block-list'
import { getCurrentUserWithBusiness } from '@/lib/auth/user'
import { computeServiceFit, SERVICE_FIT_WINDOW_DAYS } from '@/lib/availability/service-fit'
import { getEffectiveBlocks } from '@/lib/availability/effective-blocks'

export default async function AvailabilityPage() {
  const userData = await getCurrentUserWithBusiness()

  if (!userData?.user) {
    redirect('/login')
  }

  if (!userData?.business) {
    redirect('/recover-business')
  }

  const timezone = userData.business.timezone || 'America/Santiago'
  const now = new Date()

  // Fit de servicios: semana simulada con reglas activas y bloqueos efectivos
  // (sueltos + series expandidas), sin reservas ni lead time. Todas las cargas
  // son independientes entre sí.
  const [rules, blocks, recurringSeries, services, effectiveBlocks] = await Promise.all([
    getAvailabilityRules(),
    getTimeBlocks(),
    getTimeBlockSeries(),
    getServices(),
    getEffectiveBlocks(userData.business.id, now, addDays(now, SERVICE_FIT_WINDOW_DAYS + 1), timezone),
  ])
  const serviceFits = computeServiceFit(
    services,
    rules.filter((r) => r.isActive),
    effectiveBlocks,
    timezone,
    now,
  )

  return (
    <div>
      <DashboardHeader title="Disponibilidad" subtitle="Configura tus horarios de atención y bloqueos." />
      <div className="space-y-8 p-5 md:p-10">
        <ServiceFitWarnings fits={serviceFits} />
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
            <BlockTimeModal defaultDate={null} timezone={timezone} />
          </div>
          <TimeBlockList blocks={blocks} />
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-muted-foreground">Bloqueos recurrentes</h3>
            <RecurringBlockList
              series={recurringSeries.map((s) => ({
                id: s.id,
                daysOfWeek: s.daysOfWeek,
                startTime: s.startTime,
                endTime: s.endTime,
                reason: s.reason,
                until: s.until ? s.until.toISOString() : null,
              }))}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
