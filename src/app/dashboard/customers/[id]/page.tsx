import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { DashboardHeader } from '@/components/dashboard/header'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { TruncatedCell } from '@/components/ui/truncated-cell'
import { StatusBadge } from '@/components/ui/status-badge'
import { TableMobileCard } from '@/components/ui/table-mobile-card'
import { TABLE_COL, TABLE_MIN_WIDTH } from '@/components/ui/table-widths'
import { getCustomerDetail } from '@/server/actions/customers'
import { formatBookingNumber } from '@/lib/bookings/number'
import { formatMoney } from '@/lib/money'
import { getCustomerLoyalty, getLoyaltyConfig } from '@/server/actions/loyalty'
import { getCustomerPackages, listPackageProducts } from '@/server/actions/packages'
import { getCurrentUserWithBusiness } from '@/lib/auth/user'
import { normalizePhone } from '@/lib/customers/phone'
import { CustomerEditForm } from './edit-form'
import { MarketingOptOutToggle } from './marketing-optout-toggle'
import { CustomerNotesForm } from './notes-form'
import { LoyaltyPanel } from './loyalty-panel'
import { PackagePanel } from './package-panel'
import {
  ArrowLeft,
  CalendarDays,
  MessageCircle,
  Plus,
  Banknote,
} from 'lucide-react'

export const dynamic = 'force-dynamic'

const paymentTypeLabels: Record<string, string> = {
  deposit: 'Abono',
  final_payment: 'Pago final',
  full_payment: 'Pago completo',
  refund: 'Reembolso',
  cancellation_fee: 'Cargo cancelacion',
  manual_adjustment: 'Ajuste manual',
  package_purchase: 'Compra de paquete',
}

interface Props {
  params: Promise<{ id: string }>
}

export default async function CustomerDetailPage({ params }: Props) {
  const userData = await getCurrentUserWithBusiness()

  if (!userData?.user) {
    redirect('/login')
  }

  if (!userData?.business) {
    redirect('/recover-business')
  }

  const { id } = await params
  const businessTimezone = userData.business.timezone || 'America/Santiago'

  let customer
  let error: string | null = null
  try {
    customer = await getCustomerDetail(id)
  } catch (err) {
    if (err instanceof Error && err.message === 'Cliente no encontrado') {
      notFound()
    }
    error = err instanceof Error ? err.message : 'Error al cargar el cliente'
  }

  if (error || !customer) {
    return (
      <div>
        <DashboardHeader title="Cliente" subtitle="Detalle de cliente" />
        <div className="p-5 md:p-10">
          <div className="studio-card flex min-h-[320px] flex-col items-center justify-center p-8 text-center">
            <h2 className="text-xl font-semibold text-primary">Error al cargar</h2>
            <p className="mt-2 max-w-md text-muted-foreground">{error || 'No encontrada'}</p>
            <Link href="/dashboard/customers">
              <Button className="mt-6" variant="outline">
                Volver a clientes
              </Button>
            </Link>
          </div>
        </div>
      </div>
    )
  }

  // getCustomerLoyalty corre una transacción interactiva (reconcileExpiredGrants). Si se
  // ejecuta en paralelo con otras lecturas sobre un pool chico (pgbouncer), la tx puede no
  // conseguir conexión para arrancar (P2028). Se corre sola y luego el resto en paralelo.
  const { balance, history, grants, catalog } = await getCustomerLoyalty(id)
  const [loyaltyConfig, packages, packageProducts] = await Promise.all([
    getLoyaltyConfig(),
    getCustomerPackages(id),
    listPackageProducts(),
  ])

  const currency = userData.business.currency || 'CLP'
  const sellableProducts = packageProducts
    .filter((p) => p.isActive)
    .map((p) => ({ id: p.id, name: p.name, price: p.price }))

  const cleanPhone = normalizePhone(customer.phone)
  const hasWhatsapp = cleanPhone.length >= 8
  const customerTotalValue = customer.totalPaidApproved + customer.pendingBalance

  return (
    <div>
      <DashboardHeader title={customer.name} subtitle="Detalle de cliente" />
      <div className="p-5 md:p-10">
        {/* Back + actions */}
        <div className="mb-6 flex flex-wrap items-center gap-3">
          <Link href="/dashboard/customers">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="mr-1 size-4" />
              Volver
            </Button>
          </Link>
          <div className="flex-1" />
          {hasWhatsapp ? (
            <a
              href={`https://wa.me/${cleanPhone}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              <Button variant="outline" size="sm">
                <MessageCircle className="mr-1 size-4" />
                WhatsApp
              </Button>
            </a>
          ) : (
            <Button variant="outline" size="sm" disabled title="Sin telefono valido">
              <MessageCircle className="mr-1 size-4" />
              WhatsApp
            </Button>
          )}
          {/* TODO: Wire manual booking creation once the dashboard-safe booking flow is ready. */}
          <Button variant="outline" size="sm" disabled title="Proximamente desde el panel">
            <Plus className="mr-1 size-4" />
            Nueva reserva
          </Button>
        </div>

        {/* Financial summary */}
        <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-5">
          <div className="studio-card p-4">
            <p className="studio-eyebrow">Reservas</p>
            <p className="mt-1 text-2xl font-semibold text-primary">
              {customer.bookingCount}
            </p>
          </div>
          <div className="studio-card p-4">
            <p className="studio-eyebrow">Total</p>
            <p className="mt-1 text-2xl font-semibold text-primary">
              {formatMoney(customerTotalValue)}
            </p>
          </div>
          <div className="studio-card p-4">
            <p className="studio-eyebrow">Total pagado</p>
            <p className="mt-1 text-2xl font-semibold text-green-700">
              {formatMoney(customer.totalPaidApproved)}
            </p>
          </div>
          <div className="studio-card p-4">
            <p className="studio-eyebrow">Saldo pendiente</p>
            <p
              className={`mt-1 text-2xl font-semibold ${
                customer.pendingBalance > 0 ? 'text-destructive' : 'text-primary'
              }`}
            >
              {formatMoney(customer.pendingBalance)}
            </p>
          </div>
          <div className="studio-card p-4">
            <p className="studio-eyebrow">Ultima reserva</p>
            <p className="mt-1 text-lg font-semibold text-primary">
              {customer.lastBookingAt
                ? new Date(customer.lastBookingAt).toLocaleDateString('es-CL', { timeZone: businessTimezone })
                : '—'}
            </p>
          </div>
        </div>

        {/* Two column layout */}
        <div className="grid gap-6 lg:grid-cols-3">
          {/* Left: contact + notes */}
          <div className="space-y-6 lg:col-span-1">
            {/* Contact info */}
            <div className="studio-card p-4">
              <h3 className="mb-4 text-lg font-semibold text-primary">Datos de contacto</h3>
              <CustomerEditForm customer={customer} />
              <MarketingOptOutToggle
                customerId={customer.id}
                marketingOptOutAt={customer.marketingOptOutAt}
              />
            </div>

            {/* Notes */}
            <div className="studio-card p-4">
              <h3 className="mb-3 text-lg font-semibold text-primary">Notas internas</h3>
              <p className="mb-3 text-xs text-muted-foreground">
                Solo visibles para ti y tu equipo. El cliente no puede ver estas notas.
              </p>
              <CustomerNotesForm customerId={customer.id} initialNotes={customer.notes} />
            </div>

            {/* Loyalty — solo si el negocio configuró el programa */}
            {loyaltyConfig && (
              <LoyaltyPanel
                customerId={id}
                balance={balance}
                history={history}
                label={loyaltyConfig.pointsLabel}
                grants={grants}
                catalog={catalog}
              />
            )}

            {(packages.length > 0 || sellableProducts.length > 0) && (
              <PackagePanel
                customerId={id}
                packages={packages}
                products={sellableProducts}
                currency={currency}
              />
            )}
          </div>

          {/* Right: history */}
          <div className="space-y-6 lg:col-span-2">
            {/* Bookings */}
            <div className="studio-card p-4">
              <h3 className="mb-4 text-lg font-semibold text-primary">Historial de reservas</h3>
              {customer.bookings.length === 0 ? (
                <div className="flex min-h-[120px] flex-col items-center justify-center text-center">
                  <CalendarDays className="mb-2 size-6 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">Sin reservas todavía</p>
                </div>
              ) : (
                <>
                  {/* Mobile: cards */}
                  <div className="space-y-3 lg:hidden">
                    {customer.bookings.map((booking) => (
                      <TableMobileCard
                        key={booking.id}
                        title={booking.serviceName}
                        subtitle={formatBookingNumber(booking.bookingNumber, booking.id)}
                        badge={<StatusBadge map="booking" status={booking.status} />}
                        rows={[
                          {
                            label: 'Fecha',
                            value: `${new Date(booking.startDateTime).toLocaleDateString('es-CL', { timeZone: businessTimezone })} ${new Date(booking.startDateTime).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit', timeZone: businessTimezone })}`,
                          },
                          { label: 'Total', value: formatMoney(booking.totalPrice) },
                          {
                            label: 'Saldo',
                            value:
                              booking.remainingBalance > 0
                                ? formatMoney(booking.remainingBalance)
                                : booking.status === 'cancelled' || booking.status === 'no_show' || booking.status === 'expired'
                                  ? '—'
                                  : 'Pagado',
                          },
                        ]}
                      />
                    ))}
                  </div>

                  {/* Desktop: table */}
                  <div className="hidden lg:block studio-card overflow-hidden">
                    <Table fixed className={TABLE_MIN_WIDTH}>
                      <TableHeader>
                        <TableRow className="bg-muted/50">
                          <TableHead>Servicio</TableHead>
                          <TableHead className={TABLE_COL.date}>Fecha</TableHead>
                          <TableHead className={TABLE_COL.status}>Estado</TableHead>
                          <TableHead className={TABLE_COL.money}>Total</TableHead>
                          <TableHead className={TABLE_COL.money}>Saldo</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {customer.bookings.map((booking) => (
                          <TableRow key={booking.id}>
                            <TruncatedCell
                              className="font-semibold text-primary"
                              primary={booking.serviceName}
                              secondary={formatBookingNumber(booking.bookingNumber, booking.id)}
                            />
                            <TableCell className={TABLE_COL.date}>
                              <div>{new Date(booking.startDateTime).toLocaleDateString('es-CL', { timeZone: businessTimezone })}</div>
                              <div className="text-sm text-muted-foreground">
                                {new Date(booking.startDateTime).toLocaleTimeString('es-CL', {
                                  hour: '2-digit',
                                  minute: '2-digit',
                                  timeZone: businessTimezone,
                                })}
                              </div>
                            </TableCell>
                            <TableCell className={TABLE_COL.status}>
                              <StatusBadge map="booking" status={booking.status} />
                            </TableCell>
                            <TableCell className={`${TABLE_COL.money} whitespace-normal`}>
                              {formatMoney(booking.totalPrice)}
                            </TableCell>
                            <TableCell className={`${TABLE_COL.money} whitespace-normal`}>
                              {booking.remainingBalance > 0 ? (
                                <span className="font-semibold text-destructive">
                                  {formatMoney(booking.remainingBalance)}
                                </span>
                              ) : booking.status === 'cancelled' ||
                                booking.status === 'no_show' ||
                                booking.status === 'expired' ? (
                                <span className="text-muted-foreground">—</span>
                              ) : (
                                <span className="font-semibold text-green-700">Pagado</span>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </>
              )}
            </div>

            {/* Payments */}
            <div className="studio-card p-4">
              <h3 className="mb-4 text-lg font-semibold text-primary">Historial de pagos</h3>
              {customer.payments.length === 0 ? (
                <div className="flex min-h-[120px] flex-col items-center justify-center text-center">
                  <Banknote className="mb-2 size-6 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">Sin pagos registrados</p>
                </div>
              ) : (
                <>
                  {/* Mobile: cards */}
                  <div className="space-y-3 lg:hidden">
                    {customer.payments.map((payment) => (
                      <TableMobileCard
                        key={payment.id}
                        title={formatMoney(payment.amount)}
                        subtitle={
                          paymentTypeLabels[payment.paymentType] || payment.paymentType
                        }
                        badge={<StatusBadge map="payment" status={payment.status} />}
                        rows={[
                          {
                            label: 'Fecha',
                            value: new Date(payment.paidAt ?? payment.createdAt).toLocaleDateString('es-CL', { timeZone: businessTimezone }),
                          },
                          { label: 'Método', value: payment.paymentMethod || '—' },
                        ]}
                      />
                    ))}
                  </div>

                  {/* Desktop: table */}
                  <div className="hidden lg:block studio-card overflow-hidden">
                    <Table fixed className={TABLE_MIN_WIDTH}>
                      <TableHeader>
                        <TableRow className="bg-muted/50">
                          <TableHead className={TABLE_COL.money}>Monto</TableHead>
                          <TableHead className={TABLE_COL.label}>Tipo</TableHead>
                          <TableHead className={TABLE_COL.status}>Estado</TableHead>
                          <TableHead className={TABLE_COL.date}>Fecha</TableHead>
                          <TableHead>Método</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {customer.payments.map((payment) => (
                          <TableRow key={payment.id}>
                            <TableCell className={`${TABLE_COL.money} whitespace-normal font-semibold`}>
                              {formatMoney(payment.amount)}
                            </TableCell>
                            <TableCell className={`${TABLE_COL.label} text-sm`}>
                              {paymentTypeLabels[payment.paymentType] || payment.paymentType}
                            </TableCell>
                            <TableCell className={TABLE_COL.status}>
                              <StatusBadge map="payment" status={payment.status} />
                            </TableCell>
                            <TableCell className={`${TABLE_COL.date} text-sm text-muted-foreground`}>
                              {new Date(payment.paidAt ?? payment.createdAt).toLocaleDateString('es-CL', { timeZone: businessTimezone })}
                            </TableCell>
                            <TruncatedCell
                              className="text-sm text-muted-foreground"
                              primary={payment.paymentMethod || '—'}
                            />
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
