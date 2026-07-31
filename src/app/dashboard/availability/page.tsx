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
  // series expandidas), sin reservas ni lead time.
  //
  // Se simula contra el horario y los bloqueos del SALÓN, así que el aviso sólo se
  // muestra con el salón elegido — arriba del horario de una persona diría "este
  // servicio no cabe" sobre una semana que no es la suya. Y por eso ni siquiera se
  // cargan los datos con una persona elegida: son tres queries más la expansión de las
  // series, tiradas a la basura en cada carga de la pantalla nueva. El fit por persona
  // llega con los bloqueos por persona.
  const cargaElFit = selectedId === null

  const [schedule, blocks, recurringSeries, services, effectiveBlocks] = await Promise.all([
    getWeeklySchedule(selectedId),
    getTimeBlocks(),
    getTimeBlockSeries(),
    cargaElFit ? getServices() : Promise.resolve([]),
    cargaElFit
      ? getEffectiveBlocks({
          businessId: userData.business.id,
          rangeStart: now,
          rangeEnd: addDays(now, SERVICE_FIT_WINDOW_DAYS + 1),
          timezone,
          scope: { kind: 'business' },
        })
      : Promise.resolve([]),
  ])

  const serviceFits = computeServiceFit(
    services,
    schedule.days.filter((d) => d.isActive),
    effectiveBlocks,
    timezone,
    now,
  )

  return (
    <div>
      <DashboardHeader title="Disponibilidad" subtitle="Configura tus horarios de atención y bloqueos." />
      <div className="space-y-8 p-5 md:p-10">
        <ServiceFitWarnings fits={serviceFits} vocabulary={v} />
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
                  // No cambian al elegir persona, y decirlo evita la lectura errónea de
                  // que lo que se ve abajo son los bloqueos de esa persona. Los bloqueos
                  // con dueño llegan en el PR siguiente; hasta entonces la pantalla no
                  // los promete.
                  : 'Estos bloqueos son del salón: valen para todo el equipo.'}
              </p>
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
