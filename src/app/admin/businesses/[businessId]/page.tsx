import { redirect } from 'next/navigation'
import { notFound } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/user'
import { isPlatformAdmin } from '@/lib/auth/platform-admin'
import { getBusinessPublicUrl } from '@/lib/business/urls'
import { prisma } from '@/lib/db'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { getSubscriptionStatusLabel } from '@/lib/subscriptions/enforcement'
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
  const publicUrl = getBusinessPublicUrl({ slug: business.slug, subdomain: business.subdomain })
  const bookingUrl = `${publicUrl}/book`

  const plans = await prisma.plan.findMany({
    select: { id: true, name: true },
    orderBy: { sortOrder: 'asc' },
  })

  return (
    <div>
      <div className="mb-6 flex items-center gap-3">
        <a href="/admin" className="text-sm text-muted-foreground hover:text-primary">← Volver</a>
      </div>

      <div className="mb-8 flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <h1 className="text-3xl font-semibold text-primary">{business.name}</h1>
          <p className="mt-1 text-muted-foreground">
            Creado {business.createdAt.toLocaleDateString('es-CL')}
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
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border">
                        <th className="py-2 text-left font-semibold text-muted-foreground">Cliente</th>
                        <th className="py-2 text-left font-semibold text-muted-foreground">Servicio</th>
                        <th className="py-2 text-left font-semibold text-muted-foreground">Fecha</th>
                        <th className="py-2 text-left font-semibold text-muted-foreground">Estado</th>
                        <th className="py-2 text-right font-semibold text-muted-foreground">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {business.bookings.map((booking) => (
                        <tr key={booking.id} className="border-b border-border/50">
                          <td className="py-2 text-primary">{booking.customer?.name ?? '—'}</td>
                          <td className="py-2 text-muted-foreground">{booking.service?.name ?? '—'}</td>
                          <td className="py-2 text-muted-foreground">
                            {booking.startDateTime.toLocaleDateString('es-CL')}
                          </td>
                          <td className="py-2">
                            <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold">
                              {booking.status}
                            </span>
                          </td>
                          <td className="py-2 text-right text-primary">
                            ${booking.finalAmount.toLocaleString('es-CL')}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
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
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border">
                        <th className="py-2 text-left font-semibold text-muted-foreground">Fecha</th>
                        <th className="py-2 text-left font-semibold text-muted-foreground">Tipo</th>
                        <th className="py-2 text-left font-semibold text-muted-foreground">Proveedor</th>
                        <th className="py-2 text-right font-semibold text-muted-foreground">Monto</th>
                      </tr>
                    </thead>
                    <tbody>
                      {business.payments.map((payment) => (
                        <tr key={payment.id} className="border-b border-border/50">
                          <td className="py-2 text-muted-foreground">
                            {payment.createdAt.toLocaleDateString('es-CL')}
                          </td>
                          <td className="py-2 text-primary">{payment.paymentType}</td>
                          <td className="py-2 text-muted-foreground">{payment.provider}</td>
                          <td className="py-2 text-right text-primary">
                            ${payment.amount.toLocaleString('es-CL')}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
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
                          {log.createdAt.toLocaleString('es-CL')}
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
                  <p className="text-primary">{business.trialEndsAt.toLocaleDateString('es-CL')}</p>
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
