import { redirect } from 'next/navigation'
import { DashboardHeader } from '@/components/dashboard/header'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { getCurrentUserWithBusiness } from '@/lib/auth/user'
import { getCurrentSubscription } from '@/server/actions/subscriptions'
import { BadgeCheck, CircleAlert, CircleX, Clock } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { TruncatedCell } from '@/components/ui/truncated-cell'
import { StatusBadge } from '@/components/ui/status-badge'
import { formatMoney } from '@/lib/money'
import { TableMobileCard } from '@/components/ui/table-mobile-card'
import { TABLE_COL, TABLE_MIN_WIDTH } from '@/components/ui/table-widths'

const statusLabels: Record<string, string> = {
  trialing: 'En prueba',
  active: 'Activo',
  past_due: 'Pago pendiente',
  suspended: 'Suspendido',
  cancelled: 'Cancelado',
}

const statusIcons: Record<string, React.ComponentType<{ className?: string }>> = {
  trialing: Clock,
  active: BadgeCheck,
  past_due: CircleAlert,
  suspended: CircleX,
  cancelled: CircleX,
}

const statusColors: Record<string, string> = {
  trialing: 'bg-blue-100 text-blue-800',
  active: 'bg-green-100 text-green-800',
  past_due: 'bg-yellow-100 text-yellow-800',
  suspended: 'bg-red-100 text-red-800',
  cancelled: 'bg-stone-100 text-stone-800',
}

export default async function BillingPage() {
  const userData = await getCurrentUserWithBusiness()

  if (!userData?.user) {
    redirect('/login')
  }

  if (!userData?.business) {
    redirect('/recover-business')
  }

  const business = userData.business
  const { subscription, payments } = await getCurrentSubscription()
  const supportEmail = process.env.NEXT_PUBLIC_SUPPORT_EMAIL

  if (!subscription) {
    return (
      <div>
        <DashboardHeader title="Facturación" subtitle="Gestiona tu plan y pagos de suscripción" />
        <div className="p-5 md:p-10">
          <Card>
            <CardContent className="p-10 text-center">
              <CircleAlert className="mx-auto mb-3 size-10 text-muted-foreground" />
              <p className="text-muted-foreground">No se encontró información de suscripción.</p>
              {supportEmail && (
                <p className="text-xs text-muted-foreground mt-1">
                  Contacta a <a href={`mailto:${supportEmail}`} className="font-semibold text-primary">{supportEmail}</a>
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    )
  }

  const status = subscription.status
  const StatusIcon = statusIcons[status] ?? CircleAlert
  const plan = subscription.plan

  return (
    <div>
      <DashboardHeader title="Facturación" subtitle="Gestiona tu plan y pagos de suscripción" />
      <div className="p-5 md:p-10">
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2 space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Plan actual</CardTitle>
                <CardDescription>Tu plan y estado de suscripción</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="flex items-center gap-3 mb-2">
                      <h3 className="text-2xl font-semibold text-primary">{plan?.name ?? 'Plan no asignado'}</h3>
                      <span className={cn('inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold', statusColors[status])}>
                        <StatusIcon className="size-3.5" />
                        {statusLabels[status] ?? status}
                      </span>
                    </div>
                    {plan && (
                      <p className="text-sm text-muted-foreground">
                        ${plan.priceMonthly.toLocaleString('es-CL')} CLP / mes
                        {plan.priceYearly > 0 && ` · $${plan.priceYearly.toLocaleString('es-CL')} CLP / año`}
                      </p>
                    )}
                  </div>
                </div>

                <div className="mt-6 grid gap-4 sm:grid-cols-2">
                  {subscription.trialStartAt && (
                    <div className="rounded-lg border border-border bg-muted/30 p-4">
                      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Inicio de prueba</p>
                      <p className="mt-1 text-sm font-semibold text-primary">
                        {subscription.trialStartAt.toLocaleDateString('es-CL')}
                      </p>
                    </div>
                  )}
                  {subscription.trialEndAt && (
                    <div className="rounded-lg border border-border bg-muted/30 p-4">
                      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Fin de prueba</p>
                      <p className="mt-1 text-sm font-semibold text-primary">
                        {subscription.trialEndAt.toLocaleDateString('es-CL')}
                      </p>
                    </div>
                  )}
                  <div className="rounded-lg border border-border bg-muted/30 p-4">
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Periodo actual</p>
                    <p className="mt-1 text-sm font-semibold text-primary">
                      {subscription.currentPeriodStart.toLocaleDateString('es-CL')} - {subscription.currentPeriodEnd.toLocaleDateString('es-CL')}
                    </p>
                  </div>
                  <div className="rounded-lg border border-border bg-muted/30 p-4">
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Ciclo</p>
                    <p className="mt-1 text-sm font-semibold capitalize text-primary">
                      {subscription.interval === 'monthly' ? 'Mensual' : 'Anual'}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {payments.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle>Historial de pagos</CardTitle>
                  <CardDescription>Pagos de suscripción registrados</CardDescription>
                </CardHeader>
                <CardContent>
                  <>
                    {/* Mobile: cards */}
                    <div className="space-y-3 lg:hidden">
                      {payments.map((payment) => (
                        <TableMobileCard
                          key={payment.id}
                          title={formatMoney(payment.amount)}
                          subtitle={payment.paymentMethod ?? '—'}
                          badge={<StatusBadge map="payment" status={payment.status} />}
                          rows={[
                            {
                              label: 'Fecha',
                              value: (payment.paidAt ?? payment.createdAt).toLocaleDateString('es-CL'),
                            },
                            { label: 'Notas', value: payment.notes ?? '—' },
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
                            <TableHead className={TABLE_COL.money}>Monto</TableHead>
                            <TableHead className={TABLE_COL.label}>Método</TableHead>
                            <TableHead className={TABLE_COL.status}>Estado</TableHead>
                            <TableHead>Notas</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {payments.map((payment) => (
                            <TableRow key={payment.id}>
                              <TableCell className={TABLE_COL.date}>
                                {(payment.paidAt ?? payment.createdAt).toLocaleDateString('es-CL')}
                              </TableCell>
                              <TableCell className={`${TABLE_COL.money} whitespace-normal font-semibold`}>
                                {formatMoney(payment.amount)}
                              </TableCell>
                              <TableCell className={`${TABLE_COL.label} text-muted-foreground`}>
                                {payment.paymentMethod ?? '—'}
                              </TableCell>
                              <TableCell className={TABLE_COL.status}>
                                <StatusBadge map="payment" status={payment.status} />
                              </TableCell>
                              <TruncatedCell className="text-muted-foreground" primary={payment.notes ?? '—'} />
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </>
                </CardContent>
              </Card>
            )}
          </div>

          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Instrucciones de pago</CardTitle>
                <CardDescription>La suscripción se paga de forma manual durante la beta</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4 text-sm text-muted-foreground">
                <p>Durante el período beta, los pagos de suscripción se gestionan manualmente.</p>
                <div className="rounded-lg border border-border bg-muted/30 p-4">
                  <p className="font-semibold text-primary mb-2">Pasos:</p>
                  <ol className="list-decimal pl-4 space-y-2">
                    <li>Realiza una transferencia a la cuenta de Agendita (datos proporcionados por soporte).</li>
                    <li>Envía el comprobante a nuestro equipo.</li>
                    <li>Confirmaremos el pago y activaremos tu suscripción.</li>
                  </ol>
                </div>
                {supportEmail ? (
                  <p className="text-xs">
                    Contacto para pagos: <a href={`mailto:${supportEmail}`} className="font-semibold text-primary underline">{supportEmail}</a>
                  </p>
                ) : (
                  <p className="text-xs">
                    Pronto estará disponible el pago automático con tarjeta.
                  </p>
                )}
              </CardContent>
            </Card>

            {business.subscriptionStatus === 'trialing' && subscription.trialEndAt && (
              <Card className="border-blue-200 bg-blue-50/50">
                <CardContent className="p-6">
                  <div className="flex items-center gap-3">
                    <Clock className="size-5 text-blue-600" />
                    <div>
                      <p className="font-semibold text-blue-800">Período de prueba activo</p>
                      <p className="text-sm text-blue-600">
                        Tu prueba gratuita termina el {subscription.trialEndAt.toLocaleDateString('es-CL')}.
                        Todas las funcionalidades están disponibles.
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {business.subscriptionStatus === 'past_due' && (
              <Card className="border-yellow-200 bg-yellow-50/50">
                <CardContent className="p-6">
                  <div className="flex items-center gap-3">
                    <CircleAlert className="size-5 text-yellow-600" />
                    <div>
                      <p className="font-semibold text-yellow-800">Pago pendiente</p>
                      <p className="text-sm text-yellow-600">
                        Tu suscripción tiene un pago pendiente. Regulariza tu pago pronto para evitar interrupciones.
                      </p>
                      {supportEmail && (
                        <p className="mt-1 text-sm text-yellow-700">
                          Contacto: <a href={`mailto:${supportEmail}`} className="font-semibold underline">{supportEmail}</a>
                        </p>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {business.subscriptionStatus === 'suspended' && (
              <Card className="border-red-200 bg-red-50/50">
                <CardContent className="p-6">
                  <div className="flex items-center gap-3">
                    <CircleX className="size-5 text-red-600" />
                    <div>
                      <p className="font-semibold text-red-800">Cuenta suspendida</p>
                      <p className="text-sm text-red-600">
                        Tu cuenta ha sido suspendida.
                        {supportEmail && (
                          <> Contacta a <a href={`mailto:${supportEmail}`} className="font-semibold underline">{supportEmail}</a> para reactivar.</>
                        )}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
