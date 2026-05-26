import { redirect } from 'next/navigation'
import { DashboardHeader } from '@/components/dashboard/header'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { getCurrentUserWithBusiness } from '@/lib/auth/user'
import {
  getPaymentAccountStatus,
  startMercadoPagoConnect,
} from '@/server/actions/mercado-pago-connect'
import { resolveOnlinePaymentAvailabilityForBusiness } from '@/lib/payments/factory'
import { BadgeCheck, CircleAlert, Link2, Link2Off, TestTube } from 'lucide-react'
import { DisconnectButton } from './disconnect-button'

interface PaymentsSettingsPageProps {
  params: Promise<Record<string, never>>
  searchParams: Promise<{ success?: string; error?: string }>
}

export default async function PaymentsSettingsPage(props: PaymentsSettingsPageProps) {
  const userData = await getCurrentUserWithBusiness()
  const { success, error } = await props.searchParams

  if (!userData?.business) {
    redirect('/login')
  }

  const businessId = userData.business.id
  const [account, availability] = await Promise.all([
    getPaymentAccountStatus(),
    resolveOnlinePaymentAvailabilityForBusiness(businessId),
  ])

  const isConnected = account?.status === 'connected'
  const isDisconnected = account?.status === 'disconnected'
  const isSandbox = process.env.NODE_ENV !== 'production'

  return (
    <div>
      <DashboardHeader title="Pagos online" subtitle="Conecta Mercado Pago para recibir pagos de tus clientas" />
      <div className="p-5 md:p-10 max-w-2xl">
        {success && (
          <div className="mb-6 rounded-lg border border-green-200 bg-green-50/50 p-4 text-sm text-green-800">
            Cuenta de Mercado Pago conectada exitosamente. Tus clientas ya pueden pagar con tarjeta.
          </div>
        )}
        {error && (
          <div className="mb-6 rounded-lg border border-red-200 bg-red-50/50 p-4 text-sm text-red-800">
            Error al conectar Mercado Pago: {error}
          </div>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Mercado Pago</CardTitle>
            <CardDescription>
              Los pagos de tus clientas van directo a tu cuenta de Mercado Pago.
              Agendita no retiene ni cobra comisión sobre los pagos.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {isConnected ? (
              <>
                <div className="rounded-lg border border-green-200 bg-green-50/50 p-4">
                  <div className="flex items-center gap-3">
                    <BadgeCheck className="size-5 text-green-600" />
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="font-semibold text-green-800">Cuenta MP conectada</p>
                        {!isSandbox && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">
                            producción
                          </span>
                        )}
                        {isSandbox && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-yellow-100 px-2 py-0.5 text-xs font-medium text-yellow-700">
                            <TestTube className="size-3" />
                            pruebas
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-green-600">
                        {account?.connectedAt
                          ? `Conectada el ${account.connectedAt.toLocaleDateString('es-CL')}`
                          : 'Activa'}
                      </p>
                    </div>
                  </div>
                </div>

                <form>
                  <input type="hidden" name="action" value="disconnect" />
                  <DisconnectButton />
                </form>
              </>
            ) : isDisconnected ? (
              <>
                <div className="rounded-lg border border-yellow-200 bg-yellow-50/50 p-4">
                  <div className="flex items-center gap-3">
                    <CircleAlert className="size-5 text-yellow-600" />
                    <div>
                      <p className="font-semibold text-yellow-800">Cuenta desconectada</p>
                      <p className="text-sm text-yellow-600">
                        Vuelve a conectar tu cuenta para habilitar pagos online.
                      </p>
                    </div>
                  </div>
                </div>

                <form action={startMercadoPagoConnect}>
                  <Button type="submit" className="h-11">
                    <Link2 className="mr-2 size-4" />
                    Reconectar Mercado Pago
                  </Button>
                </form>
              </>
            ) : (
              <>
                <div className="rounded-lg border border-muted bg-muted/30 p-4">
                  <div className="flex items-center gap-3">
                    <CircleAlert className="size-5 text-muted-foreground" />
                    <div>
                      <p className="font-semibold text-primary">Mercado Pago no configurado</p>
                      <p className="text-sm text-muted-foreground">
                        Conecta tu cuenta de Mercado Pago para que tus clientas paguen con tarjeta.
                        El dinero cae directamente en tu cuenta.
                      </p>
                    </div>
                  </div>
                </div>

                <form action={startMercadoPagoConnect}>
                  <Button type="submit" className="h-11">
                    <Link2 className="mr-2 size-4" />
                    Conectar Mercado Pago
                  </Button>
                </form>
              </>
            )}

            <div className="rounded-lg bg-muted/40 p-4 text-sm text-muted-foreground space-y-1">
              <p className="font-semibold text-primary">¿Cómo funciona?</p>
              <ul className="list-disc pl-4 space-y-1">
                <li>Conectas tu cuenta de Mercado Pago (gratis, sin costo adicional).</li>
                <li>Tus clientas pagan con tarjeta, débito o crédito.</li>
                <li>El dinero llega directamente a tu cuenta de Mercado Pago.</li>
                <li>Agendita no retiene ni cobra comisiones sobre reservas.</li>
                <li>La suscripción de Agendita se paga por separado.</li>
              </ul>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
