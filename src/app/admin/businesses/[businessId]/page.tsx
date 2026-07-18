import Link from 'next/link'
import { redirect } from 'next/navigation'
import { notFound } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/user'
import { isPlatformAdmin } from '@/lib/auth/platform-admin'
import { getBusinessPublicUrl } from '@/lib/business/urls'
import { prisma } from '@/lib/db'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { getSubscriptionStatusLabel } from '@/lib/subscriptions/enforcement'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { TruncatedCell } from '@/components/ui/truncated-cell'
import { StatusBadge } from '@/components/ui/status-badge'
import { TableMobileCard } from '@/components/ui/table-mobile-card'
import { formatMoney } from '@/lib/money'
import { TABLE_COL, TABLE_MIN_WIDTH } from '@/components/ui/table-widths'
import { AdminActions } from './admin-actions'
import { CopyLinkButton } from './copy-link-button'

interface BusinessDetailPageProps {
  params: Promise<{ businessId: string }>
}

export default async function BusinessDetailPage({ params }: BusinessDetailPageProps) {
  const user = await getCurrentUser()
  const { businessId } = await params

  if (!user?.email || !isPlatformAdmin(user.email)) {
    redirect('/login')
  }

  const business = await prisma.business.findUnique({
    where: { id: businessId },
    include: {
      plan: true,
      subscriptions: {
        include: { plan: true, payments: true },
        orderBy: { createdAt: 'desc' },
      },
      services: { orderBy: { sortOrder: 'asc' } },
      bookings: {
        include: { service: true, customer: true },
        orderBy: { startDateTime: 'desc' },
        take: 20,
      },
      payments: {
        orderBy: { createdAt: 'desc' },
        take: 10,
      },
      subscriptionLogs: {
        orderBy: { createdAt: 'desc' },
        take: 20,
      },
      _count: {
        select: { bookings: true, customers: true, payments: true },
      },
    },
  })

  if (!business) {
    notFound()
  }

  const status = business.subscriptionStatus
  // Fechas del negocio renderizadas en SU zona horaria, no la del server (UTC en Vercel).
  const tz = business.timezone
  const publicUrl = getBusinessPublicUrl({ slug: business.slug, subdomain: business.subdomain })
  const bookingUrl = `${publicUrl}/book`

  const plans = await prisma.plan.findMany({
    select: { id: true, name: true },
    orderBy: { sortOrder: 'asc' },
  })

  return (
    <div>
      <div className="mb-6 flex items-center gap-3">
        <Link href="/admin" className="text-sm text-muted-foreground hover:text-primary">← Volver</Link>
      </div>

      <div className="mb-8 flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <h1 className="text-3xl font-semibold text-primary">{business.name}</h1>
          <p className="mt-1 text-muted-foreground">
            Creado {business.createdAt.toLocaleDateString('es-CL', { timeZone: tz })}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-semibold text-muted-foreground">
              {business.plan?.name ?? 'Sin plan'}
            </span>
            <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-semibold text-muted-foreground">
              {getSubscriptionStatusLabel(status)}
            </span>
            <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-semibold text-muted-foreground">
              {business._count.bookings} reservas
            </span>
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Reservas recientes</CardTitle>
            </CardHeader>
            <CardContent>
              {business.bookings.length === 0 ? (
                <p className="text-sm text-muted-foreground">Sin reservas registradas</p>
              ) : (
                <>
                  {/* Mobile: cards */}
                  <div className="space-y-3 lg:hidden">
                    {business.bookings.map((booking) => (
                      <TableMobileCard
                        key={booking.id}
                        title={booking.customer?.name ?? '—'}
                        subtitle={booking.service?.name ?? '—'}
                        badge={<StatusBadge map="booking" status={booking.status} />}
                        rows={[
                          { label: 'Fecha', value: booking.startDateTime.toLocaleDateString('es-CL', { timeZone: tz }) },
                          { label: 'Total', value: formatMoney(booking.finalAmount, business.currency) },
                        ]}
                      />
                    ))}
                  </div>

                  {/* Desktop: table */}
                  <div className="hidden lg:block studio-card overflow-hidden">
                    <Table fixed className={TABLE_MIN_WIDTH}>
                      <TableHeader>
                        <TableRow className="bg-muted/50">
                          <TableHead>Cliente</TableHead>
                          <TableHead className={TABLE_COL.label}>Servicio</TableHead>
                          <TableHead className={TABLE_COL.date}>Fecha</TableHead>
                          <TableHead className={TABLE_COL.status}>Estado</TableHead>
                          <TableHead className={TABLE_COL.money}>Total</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {business.bookings.map((booking) => (
                          <TableRow key={booking.id}>
                            <TruncatedCell className="text-primary" primary={booking.customer?.name ?? '—'} />
                            <TruncatedCell
                              className={`${TABLE_COL.label} text-muted-foreground`}
                              primary={booking.service?.name ?? '—'}
                            />
                            <TableCell className={`${TABLE_COL.date} text-muted-foreground`}>
                              {booking.startDateTime.toLocaleDateString('es-CL', { timeZone: tz })}
                            </TableCell>
                            <TableCell className={TABLE_COL.status}>
                              <StatusBadge map="booking" status={booking.status} />
                            </TableCell>
                            <TableCell className={`${TABLE_COL.money} whitespace-normal text-primary`}>
                              {formatMoney(booking.finalAmount, business.currency)}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Pagos recientes</CardTitle>
            </CardHeader>
            <CardContent>
              {business.payments.length === 0 ? (
                <p className="text-sm text-muted-foreground">Sin pagos registrados</p>
              ) : (
                <>
                  {/* Mobile: cards */}
                  <div className="space-y-3 lg:hidden">
                    {business.payments.map((payment) => (
                      <TableMobileCard
                        key={payment.id}
                        title={formatMoney(payment.amount, payment.currency)}
                        subtitle={payment.paymentType}
                        rows={[
                          { label: 'Fecha', value: payment.createdAt.toLocaleDateString('es-CL', { timeZone: tz }) },
                          { label: 'Proveedor', value: payment.provider },
                        ]}
                      />
                    ))}
                  </div>

                  {/* Desktop: table */}
                  <div className="hidden lg:block studio-card overflow-hidden">
                    <Table fixed className={TABLE_MIN_WIDTH}>
                      <TableHeader>
                        <TableRow className="bg-muted/50">
                          <TableHead className={TABLE_COL.date}>Fecha</TableHead>
                          <TableHead>Tipo</TableHead>
                          <TableHead className={TABLE_COL.label}>Proveedor</TableHead>
                          <TableHead className={TABLE_COL.money}>Monto</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {business.payments.map((payment) => (
                          <TableRow key={payment.id}>
                            <TableCell className={`${TABLE_COL.date} text-muted-foreground`}>
                              {payment.createdAt.toLocaleDateString('es-CL', { timeZone: tz })}
                            </TableCell>
                            <TruncatedCell className="text-primary" primary={payment.paymentType} />
                            <TableCell className={`${TABLE_COL.label} text-muted-foreground`}>
                              {payment.provider}
                            </TableCell>
                            <TableCell className={`${TABLE_COL.money} whitespace-normal text-primary`}>
                              {formatMoney(payment.amount, payment.currency)}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Bitácora de cambios</CardTitle>
            </CardHeader>
            <CardContent>
              {business.subscriptionLogs.length === 0 ? (
                <p className="text-sm text-muted-foreground">Sin eventos registrados</p>
              ) : (
                <div className="space-y-3">
                  {business.subscriptionLogs.map((log) => (
                    <div key={log.id} className="rounded-lg border border-border bg-muted/30 p-3">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-primary">{log.action}</span>
                        <span className="text-xs text-muted-foreground">
                          {log.createdAt.toLocaleString('es-CL', { timeZone: tz })}
                        </span>
                      </div>
                      {log.notes && (
                        <p className="mt-1 text-xs text-muted-foreground">{log.notes}</p>
                      )}
                      <div className="mt-1 flex gap-3 text-xs text-muted-foreground">
                        {log.beforeStatus && <span>Antes: {log.beforeStatus}</span>}
                        {log.afterStatus && <span>Después: {log.afterStatus}</span>}
                        {log.adminEmail && <span>Por: {log.adminEmail}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Links públicos</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <p className="mb-1.5 text-xs font-semibold text-muted-foreground">Perfil público</p>
                <div className="flex items-center gap-2">
                  <div className="flex-1 truncate text-sm text-primary">{publicUrl}</div>
                  <CopyLinkButton url={publicUrl} />
                </div>
              </div>
              <div>
                <p className="mb-1.5 text-xs font-semibold text-muted-foreground">Reserva online</p>
                <div className="flex items-center gap-2">
                  <div className="flex-1 truncate text-sm text-primary">{bookingUrl}</div>
                  <CopyLinkButton url={bookingUrl} />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Información</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div>
                <p className="font-semibold text-muted-foreground">Ciudad</p>
                <p className="text-primary">{business.city}</p>
              </div>
              <div>
                <p className="font-semibold text-muted-foreground">Moneda</p>
                <p className="text-primary">{business.currency}</p>
              </div>
              <div>
                <p className="font-semibold text-muted-foreground">Servicios</p>
                <p className="text-primary">{business.services.length}</p>
              </div>
              <div>
                <p className="font-semibold text-muted-foreground">Clientes</p>
                <p className="text-primary">{business._count.customers}</p>
              </div>
              {business.trialEndsAt && (
                <div>
                  <p className="font-semibold text-muted-foreground">Fin de prueba</p>
                  <p className="text-primary">{business.trialEndsAt.toLocaleDateString('es-CL', { timeZone: tz })}</p>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Acciones admin</CardTitle>
            </CardHeader>
            <CardContent>
              <AdminActions
                businessId={business.id}
                businessName={business.name}
                currentStatus={status}
                plans={plans}
              />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
