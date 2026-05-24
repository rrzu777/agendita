import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { DashboardHeader } from '@/components/dashboard/header'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { getCustomerDetail } from '@/server/actions/customers'
import { getCurrentUserWithBusiness } from '@/lib/auth/user'
import { normalizePhone } from '@/lib/customers/phone'
import { CustomerEditForm } from './edit-form'
import { CustomerNotesForm } from './notes-form'
import {
  ArrowLeft,
  CalendarDays,
  MessageCircle,
  Plus,
  Banknote,
} from 'lucide-react'

export const dynamic = 'force-dynamic'

const statusLabels: Record<string, string> = {
  pending_payment: 'Pendiente de pago',
  confirmed: 'Confirmada',
  completed: 'Completada',
  cancelled: 'Cancelada',
  no_show: 'No asistio',
  expired: 'Expirada',
}

const statusBadgeClasses: Record<string, string> = {
  pending_payment: 'bg-orange-100 text-orange-800',
  confirmed: 'bg-green-100 text-green-800',
  completed: 'bg-secondary text-secondary-foreground',
  cancelled: 'bg-muted text-muted-foreground',
  no_show: 'bg-destructive/10 text-destructive',
  expired: 'bg-muted text-muted-foreground',
}

const paymentStatusBadgeClasses: Record<string, string> = {
  pending: 'bg-orange-100 text-orange-800',
  approved: 'bg-green-100 text-green-800',
  rejected: 'bg-destructive/10 text-destructive',
  cancelled: 'bg-muted text-muted-foreground',
  refunded: 'bg-muted text-muted-foreground',
  failed: 'bg-destructive/10 text-destructive',
}

const paymentTypeLabels: Record<string, string> = {
  deposit: 'Abono',
  final_payment: 'Pago final',
  full_payment: 'Pago completo',
  refund: 'Reembolso',
  cancellation_fee: 'Cargo cancelacion',
  manual_adjustment: 'Ajuste manual',
}

function formatCLP(value: number): string {
  return value.toLocaleString('es-CL')
}

interface Props {
  params: Promise<{ id: string }>
}

export default async function CustomerDetailPage({ params }: Props) {
  const userData = await getCurrentUserWithBusiness()

  if (!userData?.business) {
    redirect('/login')
  }

  const { id } = await params

  let customer
  let error: string | null = null
  try {
    customer = await getCustomerDetail(id)
  } catch (err) {
    if (err instanceof Error && err.message === 'Clienta no encontrada') {
      notFound()
    }
    error = err instanceof Error ? err.message : 'Error al cargar la clienta'
  }

  if (error || !customer) {
    return (
      <div>
        <DashboardHeader title="Clienta" subtitle="Detalle de clienta" />
        <div className="p-5 md:p-10">
          <div className="studio-card flex min-h-[320px] flex-col items-center justify-center p-8 text-center">
            <h2 className="text-xl font-semibold text-primary">Error al cargar</h2>
            <p className="mt-2 max-w-md text-muted-foreground">{error || 'No encontrada'}</p>
            <Link href="/dashboard/customers">
              <Button className="mt-6" variant="outline">
                Volver a clientas
              </Button>
            </Link>
          </div>
        </div>
      </div>
    )
  }

  const cleanPhone = normalizePhone(customer.phone)
  const hasWhatsapp = cleanPhone.length >= 8

  return (
    <div>
      <DashboardHeader title={customer.name} subtitle="Detalle de clienta" />
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
        <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div className="studio-card p-4">
            <p className="studio-eyebrow">Reservas</p>
            <p className="mt-1 text-2xl font-semibold text-primary">
              {customer.bookingCount}
            </p>
          </div>
          <div className="studio-card p-4">
            <p className="studio-eyebrow">Total pagado</p>
            <p className="mt-1 text-2xl font-semibold text-green-700">
              ${formatCLP(customer.totalPaidApproved)}
            </p>
          </div>
          <div className="studio-card p-4">
            <p className="studio-eyebrow">Saldo pendiente</p>
            <p
              className={`mt-1 text-2xl font-semibold ${
                customer.pendingBalance > 0 ? 'text-destructive' : 'text-primary'
              }`}
            >
              ${formatCLP(customer.pendingBalance)}
            </p>
          </div>
          <div className="studio-card p-4">
            <p className="studio-eyebrow">Ultima reserva</p>
            <p className="mt-1 text-lg font-semibold text-primary">
              {customer.lastBookingAt
                ? new Date(customer.lastBookingAt).toLocaleDateString('es-CL')
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
            </div>

            {/* Notes */}
            <div className="studio-card p-4">
              <h3 className="mb-3 text-lg font-semibold text-primary">Notas internas</h3>
              <p className="mb-3 text-xs text-muted-foreground">
                Solo visibles para ti y tu equipo. La clienta no puede ver estas notas.
              </p>
              <CustomerNotesForm customerId={customer.id} initialNotes={customer.notes} />
            </div>
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
                  <div className="space-y-3 md:hidden">
                    {customer.bookings.map((booking) => (
                      <div
                        key={booking.id}
                        className="rounded-xl border border-border/60 bg-background p-3"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <p className="font-semibold text-primary">{booking.serviceName}</p>
                            <p className="text-xs text-muted-foreground">
                              {new Date(booking.startDateTime).toLocaleDateString('es-CL')}{' '}
                              {new Date(booking.startDateTime).toLocaleTimeString('es-CL', {
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </p>
                          </div>
                          <Badge className={statusBadgeClasses[booking.status] || ''}>
                            {statusLabels[booking.status] || booking.status}
                          </Badge>
                        </div>
                        <div className="mt-2 flex items-center justify-between text-xs">
                          <span className="text-muted-foreground">
                            ${formatCLP(booking.totalPrice)}
                          </span>
                          {booking.remainingBalance > 0 && (
                            <span className="font-semibold text-destructive">
                              Saldo: ${formatCLP(booking.remainingBalance)}
                            </span>
                          )}
                          {booking.remainingBalance <= 0 &&
                            (booking.status === 'completed' || booking.status === 'confirmed') && (
                              <span className="font-semibold text-green-700">Pagado</span>
                            )}
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Desktop: table */}
                  <div className="hidden overflow-hidden rounded-xl border border-border/60 md:block">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-muted/50">
                          <TableHead>Servicio</TableHead>
                          <TableHead>Fecha</TableHead>
                          <TableHead>Estado</TableHead>
                          <TableHead className="text-right">Total</TableHead>
                          <TableHead className="text-right">Saldo</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {customer.bookings.map((booking) => (
                          <TableRow key={booking.id}>
                            <TableCell className="font-semibold text-primary">
                              {booking.serviceName}
                            </TableCell>
                            <TableCell className="text-sm text-muted-foreground">
                              {new Date(booking.startDateTime).toLocaleDateString('es-CL')}{' '}
                              {new Date(booking.startDateTime).toLocaleTimeString('es-CL', {
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </TableCell>
                            <TableCell>
                              <Badge className={statusBadgeClasses[booking.status] || ''}>
                                {statusLabels[booking.status] || booking.status}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-right">
                              ${formatCLP(booking.totalPrice)}
                            </TableCell>
                            <TableCell className="text-right">
                              {booking.remainingBalance > 0 ? (
                                <span className="font-semibold text-destructive">
                                  ${formatCLP(booking.remainingBalance)}
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
                  <div className="space-y-3 md:hidden">
                    {customer.payments.map((payment) => (
                      <div
                        key={payment.id}
                        className="rounded-xl border border-border/60 bg-background p-3"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <p className="font-semibold text-primary">
                              ${formatCLP(payment.amount)}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {paymentTypeLabels[payment.paymentType] || payment.paymentType}
                              {payment.paymentMethod && ` · ${payment.paymentMethod}`}
                            </p>
                          </div>
                          <Badge
                            className={paymentStatusBadgeClasses[payment.status] || ''}
                          >
                            {payment.status}
                          </Badge>
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {payment.paidAt
                            ? new Date(payment.paidAt).toLocaleDateString('es-CL')
                            : new Date(payment.createdAt).toLocaleDateString('es-CL')}
                        </p>
                      </div>
                    ))}
                  </div>

                  {/* Desktop: table */}
                  <div className="hidden overflow-hidden rounded-xl border border-border/60 md:block">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-muted/50">
                          <TableHead className="text-right">Monto</TableHead>
                          <TableHead>Tipo</TableHead>
                          <TableHead>Estado</TableHead>
                          <TableHead>Fecha</TableHead>
                          <TableHead>Metodo</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {customer.payments.map((payment) => (
                          <TableRow key={payment.id}>
                            <TableCell className="text-right font-semibold">
                              ${formatCLP(payment.amount)}
                            </TableCell>
                            <TableCell className="text-sm">
                              {paymentTypeLabels[payment.paymentType] || payment.paymentType}
                            </TableCell>
                            <TableCell>
                              <Badge
                                className={paymentStatusBadgeClasses[payment.status] || ''}
                              >
                                {payment.status}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-sm text-muted-foreground">
                              {payment.paidAt
                                ? new Date(payment.paidAt).toLocaleDateString('es-CL')
                                : new Date(payment.createdAt).toLocaleDateString('es-CL')}
                            </TableCell>
                            <TableCell className="text-sm text-muted-foreground">
                              {payment.paymentMethod || '—'}
                            </TableCell>
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
