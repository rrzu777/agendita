import { redirect } from 'next/navigation'
import { DashboardHeader } from '@/components/dashboard/header'
import { getBookings } from '@/server/actions/bookings'
import { getCurrentUserWithBusiness } from '@/lib/auth/user'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { updateBookingStatus } from '@/server/actions/bookings'
import { CalendarDays, Clock, User, CreditCard, Phone, Plus, RefreshCw } from 'lucide-react'
import { BookingContactButtons } from '@/components/dashboard/booking-contact-buttons'
import { CancelBookingButton } from '@/components/dashboard/cancel-booking-button'
import { ManualPaymentDialog } from '@/components/dashboard/manual-payment-dialog'
import { isManualPaymentAllowed } from '@/components/dashboard/manual-payment-utils'

const statusLabels: Record<string, string> = {
  pending_payment: 'Pendiente de pago',
  confirmed: 'Confirmada',
  completed: 'Completada',
  cancelled: 'Cancelada',
  no_show: 'No asistió',
}

const statusColors: Record<string, string> = {
  pending_payment: 'bg-orange-100 text-orange-800',
  confirmed: 'bg-green-100 text-green-800',
  completed: 'bg-secondary text-secondary-foreground',
  cancelled: 'bg-muted text-muted-foreground',
  no_show: 'bg-destructive/10 text-destructive',
}

function EmptyState() {
  return (
    <div className="studio-card p-8 text-center">
      <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-full bg-muted">
        <CalendarDays className="size-7 text-muted-foreground" />
      </div>
      <h3 className="mb-2 text-lg font-semibold text-primary">No tienes reservas todavía</h3>
      <p className="mb-6 text-sm text-muted-foreground">
        Cuando un cliente reserve a través de tu enlace, aparecerá aquí.
      </p>
    </div>
  )
}

function BookingCard({ booking, businessCurrency, businessTimezone, businessAddress }: {
  booking: {
    id: string
    startDateTime: Date
    status: string
    depositPaid: number
    depositRequired: number
    finalAmount: number
    paymentStatus: string
    totalPrice: number
    remainingBalance: number
    service: { name: string } | null
    customer: { name: string; phone: string | null } | null
  }
  businessCurrency: string
  businessTimezone: string
  businessAddress: string | null
}) {
  const canRegisterPayment = isManualPaymentAllowed(booking)

  return (
    <article className="studio-card p-5">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-lg font-semibold text-primary truncate">{booking.service?.name || 'Servicio'}</h3>
          <p className="text-sm text-muted-foreground">#{booking.id.slice(0, 8)}</p>
        </div>
        <Badge className={`shrink-0 ${statusColors[booking.status]}`}>
          {statusLabels[booking.status]}
        </Badge>
      </div>

      <div className="mb-4 space-y-2">
        <div className="flex items-center gap-3 text-sm">
          <Clock className="size-4 text-muted-foreground" />
          <span className="text-muted-foreground">
            {new Date(booking.startDateTime).toLocaleDateString('es-CL', { weekday: 'short', day: 'numeric', month: 'short', timeZone: businessTimezone })}
            {' · '}
            {new Date(booking.startDateTime).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit', timeZone: businessTimezone })}
          </span>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <User className="size-4 text-muted-foreground" />
          <span className="text-primary">{booking.customer?.name || 'Sin cliente'}</span>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <CreditCard className="size-4 text-muted-foreground" />
          <span className={booking.paymentStatus === 'fully_paid' ? 'text-green-700' : 'text-primary'}>
            ${booking.depositPaid.toLocaleString('es-CL')} de ${booking.finalAmount.toLocaleString('es-CL')}
          </span>
        </div>
        {booking.customer?.phone && (
          <div className="flex items-center gap-3 text-sm">
            <Phone className="size-4 text-muted-foreground" />
            <span className="text-muted-foreground">{booking.customer.phone}</span>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <BookingContactButtons
          variant="compact"
          booking={{
            customerName: booking.customer?.name || '',
            customerPhone: booking.customer?.phone || null,
            serviceName: booking.service?.name || '',
            startDateTime: booking.startDateTime.toISOString(),
            businessTimezone,
            businessCurrency,
            totalPrice: booking.totalPrice ?? 0,
            depositPaid: booking.depositPaid,
            remainingBalance: booking.remainingBalance ?? 0,
            businessAddress,
          }}
        />
      </div>

      {booking.status === 'confirmed' && (
        <div className="mt-4 flex gap-2 border-t border-border/50 pt-4">
          <form action={async () => {
            'use server'
            await updateBookingStatus(booking.id, 'completed')
          }} className="flex-1">
            <Button type="submit" variant="outline" className="w-full h-10 text-sm font-semibold">
              Completar
            </Button>
          </form>
          <a href={`/dashboard/bookings/${booking.id}/reschedule`} className="flex-1">
            <Button type="button" variant="outline" className="w-full h-10 text-sm font-semibold">
              <RefreshCw className="mr-1 size-3" />
              Reprogramar
            </Button>
          </a>
          <div className="flex-1">
            <CancelBookingButton bookingId={booking.id} size="default" />
          </div>
          {canRegisterPayment && (
            <ManualPaymentDialog
              bookings={[booking]}
              businessCurrency={businessCurrency}
              defaultBookingId={booking.id}
              triggerVariant="outline"
              triggerClassName="flex-1 h-10 text-sm font-semibold"
            />
          )}
        </div>
      )}
      {booking.status === 'pending_payment' && (
        <div className="mt-4 flex gap-2 border-t border-border/50 pt-4">
          {canRegisterPayment && (
            <ManualPaymentDialog
              bookings={[booking]}
              businessCurrency={businessCurrency}
              defaultBookingId={booking.id}
              triggerVariant="outline"
              triggerClassName="flex-1 h-10 text-sm font-semibold"
            />
          )}
          {booking.status === 'pending_payment' && (
            <CancelBookingButton bookingId={booking.id} size="default" />
          )}
        </div>
      )}
    </article>
  )
}

export default async function BookingsPage() {
  const userData = await getCurrentUserWithBusiness()

  if (!userData?.user) {
    redirect('/login')
  }

  if (!userData?.business) {
    redirect('/recover-business')
  }

  const bookings = await getBookings()
  const businessCurrency = userData.business.currency || 'CLP'
  const businessTimezone = userData.business.timezone || 'America/Santiago'
  const businessAddress = userData.business.addressText || null

  const confirmedCount = bookings.filter(b => b.status === 'confirmed').length
  const pendingCount = bookings.filter(b => b.status === 'pending_payment').length

  return (
    <div>
      <DashboardHeader
        title="Reservas"
        subtitle="Administra tus citas y el estado de tus reservas."
      />
      <div className="space-y-6 p-5 md:p-10">
        <a href="/dashboard/bookings/new">
          <Button className="h-11 rounded-lg font-semibold shadow-[0_14px_32px_rgba(51,41,32,0.18)]">
            <Plus className="mr-2 size-4" />
            Nueva reserva
          </Button>
        </a>
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="studio-card p-4">
            <p className="studio-eyebrow">Total</p>
            <p className="mt-1 text-3xl font-semibold text-primary">{bookings.length}</p>
          </div>
          <div className="studio-card p-4">
            <p className="studio-eyebrow">Confirmadas</p>
            <p className="mt-1 text-3xl font-semibold text-primary">{confirmedCount}</p>
          </div>
          <div className="studio-card p-4">
            <p className="studio-eyebrow">Pendientes de pago</p>
            <p className="mt-1 text-3xl font-semibold text-primary">{pendingCount}</p>
          </div>
        </div>

        {bookings.length === 0 ? (
          <EmptyState />
        ) : (
          <>
            <div className="hidden md:block studio-card overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead>Servicio</TableHead>
                    <TableHead>Fecha</TableHead>
                    <TableHead>Cliente</TableHead>
                    <TableHead>Estado</TableHead>
                    <TableHead>Pago</TableHead>
                    <TableHead>Contacto</TableHead>
                    <TableHead className="text-right">Acciones</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {bookings.map((booking) => (
                    <TableRow key={booking.id}>
                      <TableCell className="font-semibold text-primary">
                        <div>{booking.service?.name || 'Servicio'}</div>
                        <div className="text-xs font-normal text-muted-foreground">#{booking.id.slice(0, 8)}</div>
                      </TableCell>
                      <TableCell>
                        <div>{new Date(booking.startDateTime).toLocaleDateString('es-CL', { timeZone: businessTimezone })}</div>
                        <div className="text-sm text-muted-foreground">
                          {new Date(booking.startDateTime).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit', timeZone: businessTimezone })}
                        </div>
                      </TableCell>
                      <TableCell>{booking.customer?.name || '—'}</TableCell>
                      <TableCell>
                        <Badge className={statusColors[booking.status]}>
                          {statusLabels[booking.status]}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <span className={booking.paymentStatus === 'fully_paid' ? 'font-semibold text-green-700' : 'font-semibold text-primary'}>
                          ${booking.depositPaid.toLocaleString('es-CL')} / ${booking.finalAmount.toLocaleString('es-CL')}
                        </span>
                        {booking.remainingBalance > 0 && (
                          <div className="text-xs text-muted-foreground">
                            Saldo: ${booking.remainingBalance.toLocaleString('es-CL')}
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        <BookingContactButtons
                          variant="compact"
                          booking={{
                            customerName: booking.customer?.name || '',
                            customerPhone: booking.customer?.phone || null,
                            serviceName: booking.service?.name || '',
                            startDateTime: booking.startDateTime.toISOString(),
                            businessTimezone,
                            businessCurrency,
                            totalPrice: booking.totalPrice,
                            depositPaid: booking.depositPaid,
                            remainingBalance: booking.remainingBalance,
                            businessAddress,
                          }}
                        />
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex gap-2 justify-end">
                          {booking.status === 'confirmed' && (
                            <>
                              <form action={async () => {
                                'use server'
                                await updateBookingStatus(booking.id, 'completed')
                              }}>
                                <Button type="submit" size="sm" variant="outline">Completar</Button>
                              </form>
                              <a href={`/dashboard/bookings/${booking.id}/reschedule`}>
                                <Button type="button" size="sm" variant="outline">
                                  <RefreshCw className="mr-1 size-3" />
                                  Reprogramar
                                </Button>
                              </a>
                              <CancelBookingButton bookingId={booking.id} size="sm" />
                            </>
                          )}
                          {booking.status === 'pending_payment' && (
                            <CancelBookingButton bookingId={booking.id} size="sm" />
                          )}
                          {isManualPaymentAllowed(booking) && (
                            <ManualPaymentDialog
                              bookings={[booking]}
                              businessCurrency={businessCurrency}
                              defaultBookingId={booking.id}
                              triggerSize="sm"
                              triggerVariant="outline"
                            />
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <div className="space-y-4 md:hidden">
              {bookings.map((booking) => (
                <BookingCard
                  key={booking.id}
                  booking={booking}
                  businessCurrency={businessCurrency}
                  businessTimezone={businessTimezone}
                  businessAddress={businessAddress}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
