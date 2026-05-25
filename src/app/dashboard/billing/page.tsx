import { redirect } from 'next/navigation'
import { DashboardHeader } from '@/components/dashboard/header'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { getCurrentUserWithBusiness } from '@/lib/auth/user'
import { getCurrentSubscription } from '@/server/actions/subscriptions'
import { BadgeCheck, CircleAlert, CircleX, Clock, CreditCard } from 'lucide-react'
import { cn } from '@/lib/utils'

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

  if (!userData?.business) {
    redirect('/login')
  }

  const business = userData.business
  const { subscription, payments } = await getCurrentSubscription()

  if (!subscription) {
    return (
      <div>
        <DashboardHeader title="Facturación" subtitle="Gestiona tu plan y pagos de suscripción" />
        <div className="p-5 md:p-10">
          <Card>
            <CardContent className="p-10 text-center">
              <CircleAlert className="mx-auto mb-3 size-10 text-muted-foreground" />
              <p className="text-muted-foreground">No se encontró información de suscripción.</p>
              <p className="text-xs text-muted-foreground mt-1">Contacta a soporte para activar tu cuenta.</p>
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
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border">
                          <th className="py-3 text-left font-semibold text-muted-foreground">Fecha</th>
                          <th className="py-3 text-left font-semibold text-muted-foreground">Monto</th>
                          <th className="py-3 text-left font-semibold text-muted-foreground">Método</th>
                          <th className="py-3 text-left font-semibold text-muted-foreground">Estado</th>
                          <th className="py-3 text-left font-semibold text-muted-foreground">Notas</th>
                        </tr>
                      </thead>
                      <tbody>
                        {payments.map((payment) => (
                          <tr key={payment.id} className="border-b border-border/50">
                            <td className="py-3 text-primary">
                              {payment.paidAt
                                ? payment.paidAt.toLocaleDateString('es-CL')
                                : payment.createdAt.toLocaleDateString('es-CL')}
                            </td>
                            <td className="py-3 font-semibold text-primary">
                              ${payment.amount.toLocaleString('es-CL')}
                            </td>
                            <td className="py-3 text-muted-foreground">{payment.paymentMethod ?? '—'}</td>
                            <td className="py-3">
                              <span className={cn(
                                'inline-flex rounded-full px-2 py-0.5 text-xs font-semibold',
                                payment.status === 'approved' ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'
                              )}>
                                {payment.status === 'approved' ? 'Pagado' : payment.status}
                              </span>
                            </td>
                            <td className="py-3 text-muted-foreground max-w-[200px] truncate">{payment.notes ?? '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
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
                <p className="text-xs">
                  Pronto estará disponible el pago automático con tarjeta. El precio de lanzamiento se mantendrá para los primeros negocios.
                </p>
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
                        Tu suscripción tiene un pago pendiente. Las reservas siguen funcionando durante la beta,
                        pero regulariza tu pago pronto para evitar interrupciones.
                      </p>
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
                        Tu cuenta ha sido suspendida. Las nuevas reservas están temporalmente deshabilitadas.
                        Contacta a soporte para reactivar tu cuenta.
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
