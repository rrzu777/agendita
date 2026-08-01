import { redirect } from 'next/navigation'
import { addDays } from 'date-fns'
import { DashboardHeader } from '@/components/dashboard/header'
import { AvailabilityEditor } from '@/components/dashboard/availability-editor'
import { ScheduleScopePicker, resolveScheduleScope, SCOPE_PARAM } from '@/components/dashboard/schedule-scope-picker'
import { TimeBlockList } from '@/components/dashboard/time-block-form'
import { BlockTimeModal } from '@/components/dashboard/block-time-modal'
import { ServiceFitWarnings } from '@/components/dashboard/service-fit-warnings'
import { getVocabulary } from '@/lib/vocabulary'
import { getWeeklySchedule } from '@/server/actions/availability'
import { getProfessionals } from '@/server/actions/professionals'
import { getServices } from '@/server/actions/services'
import { getTimeBlocks, getTimeBlockSeries } from '@/server/actions/time-blocks'
import { RecurringBlockList } from '@/components/dashboard/recurring-block-list'
import { getCurrentUserWithBusiness } from '@/lib/auth/user'
import { computeServiceFit, SERVICE_FIT_WINDOW_DAYS } from '@/lib/availability/service-fit'
import { getEffectiveBlocks } from '@/lib/availability/effective-blocks'
import { blockScopeFor } from '@/lib/availability/scope'
import { blockOwnerLabel } from '@/lib/professionals/scope-label'

export default async function AvailabilityPage({
  searchParams,
}: {
  searchParams: Promise<{ [SCOPE_PARAM]?: string }>
}) {
  const userData = await getCurrentUserWithBusiness()

  if (!userData?.user) {
    redirect('/login')
  }

  if (!userData?.business) {
    redirect('/recover-business')
  }

  const timezone = userData.business.timezone || 'America/Santiago'
  const now = new Date()
  const v = getVocabulary(userData.business.category)

  // De quién es el horario que se está mirando. La resolución vive con el selector que
  // escribe los hrefs (ver `resolveScheduleScope`): son las dos mitades de un contrato.
  const professionals = await getProfessionals()
  const selected = resolveScheduleScope(professionals, await searchParams)
  const selectedId = selected?.id ?? null

  // Fit de servicios: semana simulada con reglas activas y bloqueos efectivos (sueltos +
  // series expandidas), sin reservas ni lead time. Todo lo que entra —horario, bloqueos
  // y servicios— es del alcance elegido, así que con una persona elegida el aviso habla
  // de SU semana y no de la del negocio.
  const [schedule, blocks, recurringSeries, services, effectiveBlocks] = await Promise.all([
    getWeeklySchedule(selectedId),
    getTimeBlocks(selectedId),
    getTimeBlockSeries(selectedId),
    getServices(),
    getEffectiveBlocks({
      businessId: userData.business.id,
      rangeStart: now,
      rangeEnd: addDays(now, SERVICE_FIT_WINDOW_DAYS + 1),
      timezone,
      scope: blockScopeFor(selectedId),
    }),
  ])

  // Sólo los servicios que esa persona hace: avisarle que "Color no cabe en ningún día"
  // a quien no hace color es ruido que además no tiene arreglo desde esta pantalla.
  const propios = selected === null ? services : services.filter((s) => selected.services.some((a) => a.id === s.id))

  const serviceFits = computeServiceFit(
    propios,
    schedule.days.filter((d) => d.isActive),
    effectiveBlocks,
    timezone,
    now,
  )

  const etiqueta = (name: string | null) => blockOwnerLabel(selectedId, name)

  return (
    <div>
      <DashboardHeader title="Disponibilidad" subtitle="Configura tus horarios de atención y bloqueos." />
      <div className="space-y-8 p-5 md:p-10">
        <ServiceFitWarnings fits={serviceFits} vocabulary={v} scopeName={selected?.name ?? null} />
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-heading font-semibold tracking-tight text-primary">Horario semanal</h2>
              <p className="text-sm text-muted-foreground">
                {selected === null
                  ? 'Define los días y horas en que atiendes.'
                  : `Los días y horas en que atiende ${selected.name}.`}
              </p>
            </div>
          </div>
          <ScheduleScopePicker
            professionals={professionals}
            selectedId={selectedId}
            professionalsLabel={v.Professionals}
          />
          <AvailabilityEditor
            // Sin `key` el editor conservaría el estado local al cambiar de persona y
            // mostraría el horario de la anterior: `useState` no se re-inicializa
            // porque cambien las props.
            key={selectedId ?? 'salon'}
            days={schedule.days}
            professionalId={selectedId}
            inherited={schedule.inherited}
            professionalName={selected?.name ?? null}
          />
        </div>

        <div className="space-y-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-2xl font-heading font-semibold tracking-tight text-primary">Bloqueos</h2>
              <p className="text-sm text-muted-foreground">
                {selected === null
                  ? 'Marca días o rangos en los que no estarás disponible.'
                  : `Los de ${selected.name} y los del negocio, que también le cierran la agenda.`}
              </p>
            </div>
            <BlockTimeModal
              defaultDate={null}
              timezone={timezone}
              professionals={professionals}
              defaultProfessionalId={selectedId}
            />
          </div>
          <TimeBlockList blocks={blocks.map((b) => ({ ...b, ownerLabel: etiqueta(b.professional?.name ?? null) }))} />
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
                ownerLabel: etiqueta(s.professional?.name ?? null),
              }))}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
