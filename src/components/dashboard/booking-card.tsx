'use client'

import { useState, useTransition } from 'react'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { BookingDrawer } from './booking-drawer'
import { updateBookingStatus } from '@/server/actions/bookings'
import { CheckCircle, XCircle, UserX, CreditCard, Eye } from 'lucide-react'

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
  customer: { name: string } | null
  depositPaid: number
  finalAmount: number
  remainingBalance: number
  paymentStatus: string
  customerNotes?: string | null
  internalNotes?: string | null
}

interface BookingCardProps {
  booking: CalendarBooking
  businessCurrency: string
}

export function BookingCard({ booking, businessCurrency }: BookingCardProps) {
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [isPending, startTransition] = useTransition()

  const start = new Date(booking.startDateTime)
  const end = new Date(booking.endDateTime)

  function handleStatusChange(status: string) {
    startTransition(async () => {
      await updateBookingStatus(booking.id, status as any)
    })
  }

  const canComplete = booking.status === 'confirmed'
  const canCancel = booking.status === 'pending_payment' || booking.status === 'confirmed'
  const canNoShow = booking.status === 'confirmed'
  const canRegisterPayment = booking.status === 'confirmed' && booking.remainingBalance > 0

  return (
    <>
      <div className="rounded-xl border border-border/60 bg-background p-3 md:p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold text-primary">
                {format(start, 'HH:mm', { locale: es })} - {format(end, 'HH:mm', { locale: es })}
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
          {canCancel && (
            <Button
              size="xs"
              variant="destructive"
              onClick={() => handleStatusChange('cancelled')}
              disabled={isPending}
            >
              <XCircle className="mr-1 size-3" />
              Cancelar
            </Button>
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
      />
    </>
  )
}
