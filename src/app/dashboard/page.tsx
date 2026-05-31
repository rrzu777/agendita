import { redirect } from 'next/navigation'
import { DashboardHeader } from '@/components/dashboard/header'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { getCurrentUserWithBusiness } from '@/lib/auth/user'
import { getBookings } from '@/server/actions/bookings'
import { getFinancialSummary } from '@/server/actions/ledger'
import { getBusinessPublicUrl } from '@/lib/business/urls'
import { prisma } from '@/lib/db'
import { buildSetupChecklist } from '@/lib/dashboard/setup-checklist'
import { SetupChecklist } from '@/components/dashboard/setup-checklist'
import { CalendarCheck2, CreditCard, ExternalLink, TrendingUp, Users } from 'lucide-react'

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
  const [bookings, summary, servicesCount, availabilityCount, connectedPaymentAccounts] = await Promise.all([
    getBookings(),
    getFinancialSummary(),
    prisma.service.count({ where: { businessId: business.id, isActive: true } }),
    prisma.availabilityRule.count({ where: { businessId: business.id, isActive: true } }),
    prisma.paymentAccount.count({ where: { businessId: business.id, status: 'connected' } }),
  ])

  // Calcular estadísticas reales
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const bookingsToday = bookings.filter(b => {
    const bDate = new Date(b.startDateTime)
    bDate.setHours(0, 0, 0, 0)
    return bDate.getTime() === today.getTime()
  })
  const upcomingBookings = bookings.filter(b =>
    new Date(b.startDateTime) >= today &&
    b.status !== 'cancelled' &&
    b.status !== 'no_show'
  )

  const publicUrl = getBusinessPublicUrl(business)
  const bookingUrl = getBusinessPublicUrl(business, '/book')
  const checklist = buildSetupChecklist({
    business,
    servicesCount,
    availabilityCount,
    bookingsCount: bookings.length,
    hasConnectedPaymentAccount: connectedPaymentAccounts > 0,
    publicUrl,
    bookingUrl,
  })
  const stats = [
    { label: 'Reservas hoy', value: bookingsToday.length.toString(), hint: '+ hoy', icon: CalendarCheck2 },
    { label: 'Ingresos mes', value: `$${summary.incomeMonth.toLocaleString('es-CL')}`, hint: 'Este mes', icon: CreditCard },
    { label: 'Próximas reservas', value: upcomingBookings.length.toString(), hint: 'Agenda', icon: TrendingUp },
    { label: 'Total reservas', value: bookings.length.toString(), hint: 'Histórico', icon: Users },
  ]

  return (
    <div>
      <DashboardHeader title={`Resumen de ${business.name}`} subtitle="Aquí tienes el pulso de tu estudio hoy." />
      <div className="p-5 md:p-10">
        <Card className="studio-card mb-8 border-border/60 bg-card">
          <CardContent className="p-6">
            <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
              <div>
                <h3 className="mb-1 text-lg font-semibold text-primary">Tu perfil público</h3>
                <p className="text-sm text-muted-foreground">
                  Comparte este link con tus clientes para que reserven
                </p>
                <code className="mt-3 inline-block max-w-full rounded-lg border border-border bg-muted px-3 py-2 font-mono text-sm text-primary">
                  {publicUrl}
                </code>
              </div>
              <div className="flex flex-col gap-3 sm:flex-row">
                <a
                  href={publicUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Button variant="outline" className="h-11 rounded-lg font-semibold">
                    <ExternalLink className="mr-2 size-4" />
                    Ver perfil
                  </Button>
                </a>
                <a
                  href={bookingUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Button className="h-11 rounded-lg font-semibold">
                    <CalendarCheck2 className="mr-2 size-4" />
                    Reservar
                  </Button>
                </a>
              </div>
            </div>
          </CardContent>
        </Card>

        <SetupChecklist checklist={checklist} />

        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
          {stats.map((stat) => {
            const Icon = stat.icon
            return (
              <Card key={stat.label} className="studio-card border-border/60">
                <CardHeader className="pb-1">
                  <div className="mb-3 flex items-center justify-between">
                    <div className="flex size-12 items-center justify-center rounded-xl bg-secondary text-primary">
                      <Icon className="size-5" />
                    </div>
                    <span className="rounded-full bg-muted px-3 py-1 text-xs font-semibold text-muted-foreground">{stat.hint}</span>
                  </div>
                  <CardTitle className="text-sm font-semibold text-muted-foreground">{stat.label}</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-4xl font-semibold tracking-normal text-primary">{stat.value}</div>
                </CardContent>
              </Card>
            )
          })}
        </div>

        <section className="mt-10">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-2xl font-semibold tracking-normal text-primary">Próximas citas</h2>
            <a href="/dashboard/calendar" className="text-sm font-semibold text-muted-foreground hover:text-primary">
              Ver calendario completo
            </a>
          </div>
          {upcomingBookings.length === 0 ? (
            <div className="studio-card p-8 text-center">
              <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-full bg-muted">
                <CalendarCheck2 className="size-7 text-muted-foreground" />
              </div>
              <h3 className="mb-2 text-lg font-semibold text-primary">No tienes reservas próximas</h3>
              <p className="text-sm text-muted-foreground">
                Comparte tu perfil público para recibir reservas de tus clientes.
              </p>
              <code className="mt-3 inline-block rounded-lg border border-border bg-muted px-3 py-2 font-mono text-sm text-primary">
                {publicUrl}
              </code>
            </div>
          ) : (
            <div className="space-y-4">
              {upcomingBookings.slice(0, 5).map((booking) => (
                <article key={booking.id} className="studio-card flex flex-col gap-4 p-5 md:flex-row md:items-center md:justify-between">
                  <div className="flex items-center gap-5">
                    <div className="flex size-16 flex-col items-center justify-center rounded-xl bg-accent text-primary">
                      <span className="text-xl font-semibold">
                        {new Date(booking.startDateTime).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                    <div>
                      <h3 className="text-xl font-semibold text-primary">{booking.customer?.name || 'Cliente'}</h3>
                      <p className="text-sm font-semibold uppercase tracking-[0.1em] text-muted-foreground">{booking.service?.name || 'Servicio'}</p>
                    </div>
                  </div>
                  <span className="self-start rounded-full bg-secondary px-3 py-1 text-xs font-semibold text-secondary-foreground md:self-auto">
                    {booking.status === 'confirmed' ? 'Confirmada' : booking.status === 'pending_payment' ? 'Pendiente' : booking.status}
                  </span>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
