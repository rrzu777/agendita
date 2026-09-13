import { bookingServiceName } from '@/lib/bookings/service-lines'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { DashboardHeader } from '@/components/dashboard/header'
import { DashboardPanel } from '@/components/dashboard/dashboard-panel'
import { KpiStrip } from '@/components/dashboard/kpi-strip'
import { formatInTimeZone } from 'date-fns-tz'
import { Button } from '@/components/ui/button'
import { getCurrentUserWithBusiness } from '@/lib/auth/user'
import { getDashboardBookingSummary } from '@/server/actions/bookings'
import { getFinancialSummary } from '@/server/actions/ledger'
import { getBusinessPublicUrl } from '@/lib/business/urls'
import { prisma } from '@/lib/db'
import { buildSetupChecklist } from '@/lib/dashboard/setup-checklist'
import { formatMoney } from '@/lib/money'
import { bookingStatusLabel, displayedBookingStatus } from '@/lib/bookings/status-labels'
import { holdPrecedencePaymentWhere } from '@/lib/payments/hold-precedence'
import { SetupChecklist } from '@/components/dashboard/setup-checklist'
import { PendingTransfersBanner } from '@/components/dashboard/pending-transfers-banner'
import { PendingPackageTransfersBanner } from '@/components/dashboard/pending-package-transfers-banner'
import { TourInvitation } from '@/components/dashboard/tours/tour-invitation'
import { hasPendingBalanceTransfer, hasPendingDeclaredTransfer, pendingPackageTransferWhere } from '@/lib/bank-transfer/declared'
import { businessScheduleWhere } from '@/lib/availability/scope'
import { getVocabulary } from '@/lib/vocabulary'
import { CalendarCheck2, ExternalLink, Plus } from 'lucide-react'

export const metadata = { title: 'Hoy — Agendita' }

export default async function DashboardPage() {
  const userData = await getCurrentUserWithBusiness()

  if (!userData?.user) {
    redirect('/login')
  }

  if (!userData?.business) {
    redirect('/recover-business')
  }

  if (!userData.business.onboardingCompletedAt) {
    redirect('/dashboard/onboarding')
  }

  const business = userData.business
  const v = getVocabulary(business.category)
  const now = new Date()
  const timezone = business.timezone || 'America/Santiago'
  const [bookingSummary, summary, servicesCount, availabilityCount, connectedPaymentAccounts, pendingPackageTransfersCount, nextBooking] = await Promise.all([
    getDashboardBookingSummary(now, timezone),
    getFinancialSummary(),
    prisma.service.count({ where: { businessId: business.id, isActive: true } }),
    // Progreso de onboarding ("¿ya configuró su horario?"), del SALÓN. Sin el filtro,
    // un salón de 4 personas con horario propio cuenta 28 días de atención en vez de 7.
    prisma.availabilityRule.count({ where: { ...businessScheduleWhere(business.id), isActive: true } }),
    prisma.paymentAccount.count({ where: { businessId: business.id, status: 'connected' } }),
    prisma.packagePurchase.count({ where: pendingPackageTransferWhere(business.id) }),
    // A separate bounded read: the existing summary is only five records from midnight.
    prisma.booking.findFirst({
      where: { businessId: business.id, startDateTime: { gte: now }, status: { in: ['confirmed', 'pending_payment', 'pending_confirmation'] } },
      orderBy: [{ startDateTime: 'asc' }, { id: 'asc' }],
      select: {
        id: true, startDateTime: true, status: true, paymentStatus: true, holdExpiresAt: true,
        payments: { where: holdPrecedencePaymentWhere, select: { provider: true, status: true, providerPaymentId: true } },
        customer: { select: { name: true } }, service: { select: { name: true } }, serviceLines: { select: { position: true, name: true } },
      },
    }),
  ])

  const upcomingBookings = bookingSummary.upcoming

  const publicUrl = getBusinessPublicUrl(business)
  const bookingUrl = getBusinessPublicUrl(business, '/book')
  const checklist = buildSetupChecklist({
    business,
    servicesCount,
    availabilityCount,
    bookingsCount: bookingSummary.total,
    hasConnectedPaymentAccount: connectedPaymentAccounts > 0,
    publicUrl,
    bookingUrl,
  })
  const currency = business.currency || 'CLP'
  const pendingCount = bookingSummary.pendingTransfers + pendingPackageTransfersCount
  const calendarFor = (date: Date) => `/dashboard/calendar?view=day&date=${formatInTimeZone(date, timezone, 'yyyy-MM-dd')}`
  const dateLabel = (date: Date) => new Date(date).toLocaleDateString('es-CL', { day: 'numeric', month: 'long', timeZone: timezone })
  const timeLabel = (date: Date) => new Date(date).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: timezone })

  return (
    <div>
      <DashboardHeader
        title="Cabina del día"
        subtitle={`${business.name} · ${dateLabel(now)}`}
        action={<Button asChild size="form"><Link href="/dashboard/bookings/new" data-tour-id="dashboard-new-booking"><Plus className="size-4" />Nueva reserva</Link></Button>}
      />
      <div className="mx-auto max-w-[1420px] space-y-6 p-4 min-[1100px]:p-10">
        <TourInvitation />
        <div className="grid items-start gap-6 min-[1100px]:grid-cols-[minmax(0,1.7fr)_minmax(280px,1fr)]">
          <DashboardPanel title="Próxima cita" description="La siguiente reserva por comenzar." action={<Button asChild variant="outline"><Link href={calendarFor(nextBooking?.startDateTime ?? now)}>Ver calendario</Link></Button>}>
            {nextBooking ? (
              <div className="flex flex-col gap-5 min-[721px]:flex-row min-[721px]:items-center">
                <div className="shrink-0">
                  <p className="font-mono text-4xl font-medium tracking-tight tabular-nums">{timeLabel(nextBooking.startDateTime)}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{dateLabel(nextBooking.startDateTime)}</p>
                </div>
                <div className="min-w-0 min-[721px]:border-l min-[721px]:border-border min-[721px]:pl-5">
                  <h3 className="break-words text-xl font-semibold">{nextBooking.customer?.name || v.Client}</h3>
                  <p className="mt-1 break-words text-sm text-muted-foreground">{bookingServiceName(nextBooking)}</p>
                  <p className="mt-3 text-sm font-medium">{bookingStatusLabel(displayedBookingStatus(nextBooking, now))}</p>
                </div>
              </div>
            ) : (
              <div className="py-4">
                <p className="text-lg font-medium">No tienes citas por comenzar</p>
                <p className="mt-2 text-sm text-muted-foreground">Puedes crear una reserva o compartir tu perfil público.</p>
              </div>
            )}
          </DashboardPanel>
          <DashboardPanel title="Por resolver" tone={pendingCount > 0 ? 'attention' : 'default'}>
            {pendingCount === 0 ? <p className="text-sm text-muted-foreground">Sin transferencias por verificar</p> : (
              <div className="space-y-3">
                <PendingTransfersBanner count={bookingSummary.pendingTransfers} />
                <PendingPackageTransfersBanner count={pendingPackageTransfersCount} />
              </div>
            )}
            <div className="mt-5 border-t border-border pt-4">
              <p className="text-sm font-medium">Horario y capacidad</p>
              <p className="mt-1 text-sm text-muted-foreground">Revisa los horarios del equipo y sus bloqueos antes de abrir nuevos cupos.</p>
              <Button asChild variant="ghost" className="mt-2"><Link href="/dashboard/availability">Ver disponibilidad</Link></Button>
            </div>
          </DashboardPanel>
        </div>

        <KpiStrip label="Resumen del negocio" items={[
          { label: 'Reservas hoy', value: bookingSummary.today, description: 'Incluye todos los estados' },
          { label: 'Ingresos del mes', value: formatMoney(summary.incomeMonth, currency), description: 'Ingresos registrados de reservas; no incluye paquetes' },
          { label: 'Total reservas', value: bookingSummary.total, description: 'Histórico · todos los estados' },
        ]} />

        <DashboardPanel title="Agenda desde hoy" description="Hasta cinco reservas desde el inicio de hoy; puede incluir citas ya atendidas." action={<Button asChild variant="ghost"><Link href="/dashboard/calendar">Ver calendario completo</Link></Button>}>
          {upcomingBookings.length === 0 ? (
            <p className="py-4 text-sm text-muted-foreground">No hay reservas en este resumen. Comparte tu perfil público para recibir nuevas citas.</p>
          ) : (
            <ol className="divide-y divide-border">
              {upcomingBookings.map((booking) => (
                <li key={booking.id} className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0 min-[721px]:flex-row min-[721px]:items-center min-[721px]:justify-between">
                  <div className="flex min-w-0 items-start gap-4">
                    <div className="w-28 shrink-0">
                      <time dateTime={new Date(booking.startDateTime).toISOString()} className="font-mono text-lg tabular-nums">{timeLabel(booking.startDateTime)}</time>
                      <p className="text-xs text-muted-foreground">{dateLabel(booking.startDateTime)}</p>
                    </div>
                    <div className="min-w-0">
                      <h3 className="break-words font-medium">{booking.customer?.name || v.Client}</h3>
                      <p className="break-words text-sm text-muted-foreground">{bookingServiceName(booking)}</p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-xs font-medium">
                    <span className="rounded-md bg-muted px-2 py-1">{hasPendingDeclaredTransfer(booking) ? 'Por verificar' : bookingStatusLabel(booking.status)}</span>
                    {hasPendingBalanceTransfer(booking) && <span className="rounded-md bg-warning/10 px-2 py-1 text-warning">Saldo por verificar</span>}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </DashboardPanel>

        <SetupChecklist checklist={checklist} />

        <DashboardPanel title="Tu perfil público" description={`Comparte este enlace con tus ${v.clients} para que reserven.`}>
          <div className="flex flex-col gap-4 min-[721px]:flex-row min-[721px]:items-center min-[721px]:justify-between">
            <p className="min-w-0 break-all text-sm text-muted-foreground">{publicUrl}</p>
            <div className="flex shrink-0 flex-wrap gap-2">
              <Button asChild variant="outline"><a href={publicUrl} target="_blank" rel="noopener noreferrer"><ExternalLink className="size-4" />Ver perfil</a></Button>
              <Button asChild variant="outline"><a href={bookingUrl} target="_blank" rel="noopener noreferrer"><CalendarCheck2 className="size-4" />Reservar</a></Button>
            </div>
          </div>
        </DashboardPanel>
      </div>
    </div>
  )
}
