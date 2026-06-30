'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { formatInTimeZone } from 'date-fns-tz'
import { es } from 'date-fns/locale'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { BookingDrawer } from './booking-drawer'
import { updateBookingStatus } from '@/server/actions/bookings'
import { CheckCircle, UserX, CreditCard, Eye, RefreshCw } from 'lucide-react'
import { CancelBookingButton } from './cancel-booking-button'
import { isManualPaymentAllowed } from './manual-payment-utils'

const statusLabels: Record<string, string> = {
  pending_payment: 'Pendiente de pago',
  confirmed: 'Confirmada',
  completed: 'Completada',
  cancelled: 'Cancelada',
  no_show: 'No asistió',
}

const statusBadgeClasses: Record<string, string> = {
  pending_payment: 'bg-orange-100 text-orange-800',
  confirmed: 'bg-green-100 text-green-800',
  completed: 'bg-secondary text-secondary-foreground',
  cancelled: 'bg-muted text-muted-foreground',
  no_show: 'bg-destructive/10 text-destructive',
}

export type CalendarBooking = {
  id: string
  status: string
  startDateTime: string
  endDateTime: string
  service: { name: string } | null
  customer: { name: string; phone: string; email: string | null } | null
  totalPrice: number
  depositPaid: number
  depositRequired: number
  finalAmount: number
  remainingBalance: number
  paymentStatus: string
  customerNotes?: string | null
  internalNotes?: string | null
}

interface BookingCardProps {
  booking: CalendarBooking
  businessCurrency: string
  businessTimezone: string
  businessAddress: string | null
}

export function BookingCard({ booking, businessCurrency, businessTimezone, businessAddress }: BookingCardProps) {
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [isPending, startTransition] = useTransition()
  const router = useRouter()

  const start = new Date(booking.startDateTime)
  const end = new Date(booking.endDateTime)

  function handleStatusChange(status: string) {
    startTransition(async () => {
      try {
        await updateBookingStatus(booking.id, status as 'cancelled' | 'completed' | 'no_show')
        router.refresh()
      } catch (err) {
        console.error('Error updating booking status:', err)
      }
    })
  }

  const canComplete = booking.status === 'confirmed'
  const canCancel = booking.status === 'pending_payment' || booking.status === 'confirmed'
  const canNoShow = booking.status === 'confirmed'
  const canRegisterPayment = isManualPaymentAllowed(booking)

  return (
    <>
      <div className="rounded-xl border border-border/60 bg-background p-3 md:p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold text-primary">
                {formatInTimeZone(start, businessTimezone, 'HH:mm', { locale: es })} - {formatInTimeZone(end, businessTimezone, 'HH:mm', { locale: es })}
              </span>
              <Badge className={statusBadgeClasses[booking.status] || ''}>
                {statusLabels[booking.status] || booking.status}
              </Badge>
            </div>
            <div className="mt-1 text-sm font-medium text-foreground">
              {booking.service?.name || 'Servicio desconocido'}
            </div>
            <div className="text-xs text-muted-foreground">
              {booking.customer?.name || '—'}
            </div>
            <div className="mt-1 text-xs">
              <span
                className={
                  booking.paymentStatus === 'fully_paid'
                    ? 'font-semibold text-green-700'
                    : 'font-semibold text-primary'
                }
              >
                ${booking.depositPaid.toLocaleString('es-CL')} / ${booking.finalAmount.toLocaleString('es-CL')}
              </span>
              {booking.remainingBalance > 0 && (
                <span className="ml-2 text-muted-foreground">
                  Saldo: ${booking.remainingBalance.toLocaleString('es-CL')} {businessCurrency}
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          {canComplete && (
            <Button
              size="xs"
              variant="outline"
              onClick={() => handleStatusChange('completed')}
              disabled={isPending}
            >
              <CheckCircle className="mr-1 size-3" />
              Completar
            </Button>
          )}
          {booking.status === 'confirmed' && (
            <a href={`/dashboard/bookings/${booking.id}/reschedule`}>
              <Button size="xs" variant="outline" disabled={isPending}>
                <RefreshCw className="mr-1 size-3" />
                Reprogramar
              </Button>
            </a>
          )}
          {canCancel && (
            <CancelBookingButton
              bookingId={booking.id}
              variant="destructive"
              size="xs"
              label="Cancelar"
            />
          )}
          {canNoShow && (
            <Button
              size="xs"
              variant="outline"
              onClick={() => handleStatusChange('no_show')}
              disabled={isPending}
            >
              <UserX className="mr-1 size-3" />
              No asistió
            </Button>
          )}
          {canRegisterPayment && (
            <Button
              size="xs"
              variant="outline"
              onClick={() => setDrawerOpen(true)}
              disabled={isPending}
            >
              <CreditCard className="mr-1 size-3" />
              Registrar pago
            </Button>
          )}
          <Button size="xs" variant="ghost" onClick={() => setDrawerOpen(true)}>
            <Eye className="mr-1 size-3" />
            Ver
          </Button>
        </div>
      </div>

      <BookingDrawer
        booking={booking}
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        businessCurrency={businessCurrency}
        businessTimezone={businessTimezone}
        businessAddress={businessAddress}
      />
    </>
  )
}
