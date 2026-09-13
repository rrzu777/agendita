import { KpiStrip } from '@/components/dashboard/kpi-strip'
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
import { getPhotos } from '@/server/actions/customer-photos'
import { CustomerPhotos } from '@/components/dashboard/customer-photos'
import { isObjectStorageAvailable } from '@/lib/storage/r2'
import { getCurrentUserWithBusiness } from '@/lib/auth/user'
import { ForbiddenError } from '@/lib/auth/server'
import { getVocabulary } from '@/lib/vocabulary'
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

export const metadata = { title: 'Detalle de cliente — Agendita' }

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
  const v = getVocabulary(userData.business.category)

  let customer
  let error: string | null = null
  try {
    customer = await getCustomerDetail(id)
  } catch (err) {
    // Sólo not-found/ownership → 404; un error real (DB caída, etc.) muestra la
    // card de error. Mismo patrón que campanas/[id]; el mensaje ahora depende
    // del rubro, así que la clase es el identificador, no el string.
    if (err instanceof ForbiddenError) {
      notFound()
    }
    error = err instanceof Error ? err.message : `Error al cargar ${v.theClient}`
  }

  if (error || !customer) {
    return (
      <div>
        <DashboardHeader title={v.Client} subtitle={`Detalle de ${v.client}`} />
        <div className="mx-auto max-w-[1420px] p-4 min-[1100px]:p-10">
          <div className="studio-card shadow-none flex min-h-[320px] flex-col items-center justify-center p-8 text-center">
            <h2 className="text-xl font-semibold text-foreground">Error al cargar</h2>
            <p className="mt-2 max-w-md text-muted-foreground">{error || 'No encontrada'}</p>
            <Button className="mt-6 min-h-11 min-w-11" variant="outline" asChild><Link href="/dashboard/customers">
                Volver a {v.clients}
              </Link></Button>
          </div>
        </div>
      </div>
    )
  }

  // getCustomerLoyalty corre una transacción interactiva (reconcileExpiredGrants). Si se
  // ejecuta en paralelo con otras lecturas sobre un pool chico (pgbouncer), la tx puede no
  // conseguir conexión para arrancar (P2028). Se corre sola y luego el resto en paralelo.
  const { balance, history, grants, catalog } = await getCustomerLoyalty(id)
  const [loyaltyConfig, packages, packageProducts, photosResult] = await Promise.all([
    getLoyaltyConfig(),
    getCustomerPackages(id),
    listPackageProducts(),
    getPhotos({ customerId: id }),
  ])
  // Que R2 esté caído no puede tumbar la ficha entera: sin fotos, el resto se ve.
  // El error viaja igual, para no mostrar "sin fotos" cuando en realidad falló.
  const photos = photosResult.ok ? photosResult.data : []
  const photosError = photosResult.ok ? null : photosResult.error

  const currency = userData.business.currency || 'CLP'
  const sellableProducts = packageProducts
    .filter((p) => p.isActive)
    .map((p) => ({ id: p.id, name: p.name, price: p.price }))

  const cleanPhone = normalizePhone(customer.phone)
  const hasWhatsapp = cleanPhone.length >= 8
  const customerTotalValue = customer.totalPaidApproved + customer.pendingBalance

  return (
    <div>
      <DashboardHeader title={customer.name} subtitle={`Detalle de ${v.client}`} />
      <div className="mx-auto max-w-[1420px] p-4 min-[1100px]:p-10 [&_button]:min-h-11 [&_button]:min-w-11 [&_a]:min-h-11 [&_a]:min-w-11 [&_a]:inline-flex [&_input:not([aria-hidden=true])]:min-h-11 [&_select]:min-h-11">
        {/* Back + actions */}
        <div className="mb-6 flex flex-wrap items-center gap-3">
          <Button variant="ghost" className="min-h-11 min-w-11" asChild><Link href="/dashboard/customers">
              <ArrowLeft className="mr-1 size-4" />
              Volver
            </Link></Button>
          <div className="flex-1" />
          {hasWhatsapp ? (
            <Button variant="outline" className="min-h-11 min-w-11" asChild><a
              href={`https://wa.me/${cleanPhone}`}
              target="_blank"
              rel="noopener noreferrer"
            >
                <MessageCircle className="mr-1 size-4" />
                WhatsApp
              </a></Button>
          ) : (
            <Button variant="outline" className="min-h-11 min-w-11" disabled title="Sin telefono valido">
              <MessageCircle className="mr-1 size-4" />
              WhatsApp
            </Button>
          )}
          <Button variant="outline" className="min-h-11 min-w-11" asChild><Link href={`/dashboard/bookings/new?customerId=${encodeURIComponent(customer.id)}`}>
              <Plus className="mr-1 size-4" />
              Nueva reserva
            </Link></Button>
        </div>

        <KpiStrip label="Resumen del historial" className="mb-6" items={[
          { label: 'Reservas', value: customer.bookingCount, description: 'Todo el historial' },
          { label: 'Total', value: formatMoney(customerTotalValue, currency), description: 'Pagos aprobados más saldo pendiente' },
          { label: 'Total pagado', value: formatMoney(customer.totalPaidApproved, currency), description: 'Pagos aprobados', tone: 'success' },
          { label: 'Saldo pendiente', value: formatMoney(customer.pendingBalance, currency), description: 'Por pagar', tone: customer.pendingBalance > 0 ? 'warning' : 'default' },
          { label: 'Última reserva', value: customer.lastBookingAt ? new Date(customer.lastBookingAt).toLocaleDateString('es-CL', { timeZone: businessTimezone }) : 'Sin reservas', description: customer.lastAttendedBy ? `Atendió la última vez: ${customer.lastAttendedBy}` : 'Todo el historial' },
        ]} />

        {/* Two column layout */}
        <div className="grid gap-6 lg:grid-cols-3">
          {/* Left: contact + notes */}
          <div className="space-y-6 lg:col-span-1">
            {/* Contact info */}
            <div className="studio-card shadow-none p-4">
              <h3 className="mb-4 text-lg font-semibold text-foreground">Datos de contacto</h3>
              <CustomerEditForm customer={customer} />
              <MarketingOptOutToggle
                customerId={customer.id}
                marketingOptOutAt={customer.marketingOptOutAt}
              />
            </div>

            {/* Notes */}
            <div className="studio-card shadow-none p-4">
              <h3 className="mb-3 text-lg font-semibold text-foreground">Notas internas</h3>
              <p className="mb-3 text-xs text-muted-foreground">
                Solo visibles para ti y tu equipo. {v.TheClient} no puede ver estas notas.
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
            {/* Fotos */}
            <div className="studio-card shadow-none p-4">
              <h3 className="mb-3 text-lg font-semibold text-foreground">Fotos</h3>
              <CustomerPhotos
                target={{ customerId: customer.id }}
                initialPhotos={photos}
                initialError={photosError}
                uploadEnabled={isObjectStorageAvailable()}
              />
            </div>

            {/* Bookings */}
            <div className="studio-card shadow-none p-4">
              <h3 className="mb-4 text-lg font-semibold text-foreground">Historial de reservas</h3>
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
                          ...(booking.professionalName
                            ? [{ label: 'Atiende', value: booking.professionalName }]
                            : []),
                          { label: 'Total', value: formatMoney(booking.totalPrice, currency) },
                          {
                            label: 'Saldo',
                            value:
                              booking.remainingBalance > 0
                                ? formatMoney(booking.remainingBalance, currency)
                                : booking.status === 'cancelled' || booking.status === 'no_show' || booking.status === 'expired'
                                  ? '—'
                                  : 'Pagado',
                          },
                        ]}
                      />
                    ))}
                  </div>

                  {/* Desktop: table */}
                  <div className="hidden lg:block studio-card shadow-none overflow-hidden">
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
                              className="font-semibold text-foreground"
                              primary={booking.serviceName}
                              secondary={[
                                formatBookingNumber(booking.bookingNumber, booking.id),
                                booking.professionalName && `Atiende: ${booking.professionalName}`,
                              ].filter(Boolean).join(' · ')}
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
                              {formatMoney(booking.totalPrice, currency)}
                            </TableCell>
                            <TableCell className={`${TABLE_COL.money} whitespace-normal`}>
                              {booking.remainingBalance > 0 ? (
                                <span className="font-semibold text-destructive">
                                  {formatMoney(booking.remainingBalance, currency)}
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
            <div className="studio-card shadow-none p-4">
              <h3 className="mb-4 text-lg font-semibold text-foreground">Historial de pagos</h3>
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
                        title={formatMoney(payment.amount, currency)}
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
                  <div className="hidden lg:block studio-card shadow-none overflow-hidden">
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
                              {formatMoney(payment.amount, currency)}
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
