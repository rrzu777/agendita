'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { formatInTimeZone } from 'date-fns-tz'
import { es } from 'date-fns/locale'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import type { CalendarBooking } from './booking-card'
import { BookingContactButtons } from './booking-contact-buttons'
import { CancelBookingButton } from './cancel-booking-button'
import { BookingStatusButton } from './booking-status-button'
import { RefreshCw } from 'lucide-react'
import { ManualPaymentDialog } from './manual-payment-dialog'
import { formatManualPaymentMoney, isManualPaymentAllowed } from './manual-payment-utils'
import { PaymentRevertedBadge } from './payment-reverted-badge'
import { CustomerPhotos } from './customer-photos'
import { bookingStatusLabel } from '@/lib/bookings/status-labels'
import { bookingWhere } from '@/lib/services/modality'
import { useVocabulary } from '@/components/vocabulary-provider'

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(false)
  useEffect(() => {
    const mql = window.matchMedia('(max-width: 640px)')
    // eslint-disable-next-line react-hooks/set-state-in-effect -- matchMedia requires synchronous initial state read in effect
    setIsMobile(mql.matches)
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches)
    mql.addEventListener('change', handler)
    return () => mql.removeEventListener('change', handler)
  }, [])
  return isMobile
}

const statusBadgeClasses: Record<string, string> = {
  pending_payment: 'bg-orange-100 text-orange-800',
  pending_confirmation: 'bg-amber-100 text-amber-900',
  confirmed: 'bg-green-100 text-green-800',
  completed: 'bg-secondary text-secondary-foreground',
  cancelled: 'bg-muted text-muted-foreground',
  no_show: 'bg-destructive/10 text-destructive',
  expired: 'bg-muted text-muted-foreground',
}

interface BookingDrawerProps {
  booking: CalendarBooking
  open: boolean
  onOpenChange: (open: boolean) => void
  businessCurrency: string
  businessTimezone: string
  businessAddress: string | null
  photoUploadEnabled: boolean
}

export function BookingDrawer({ booking, open, onOpenChange, businessCurrency, businessTimezone, businessAddress, photoUploadEnabled }: BookingDrawerProps) {
  const vocabulary = useVocabulary()
  const isMobile = useIsMobile()

  const start = new Date(booking.startDateTime)

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side={isMobile ? 'bottom' : 'right'} className="h-auto max-h-[85vh] sm:max-h-full">
        <SheetHeader>
          <SheetTitle>Detalle de reserva</SheetTitle>
          <SheetDescription>
            {booking.service?.name} — {formatInTimeZone(start, businessTimezone, "EEEE d 'de' MMMM, HH:mm", { locale: es })}
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-4 overflow-y-auto p-4">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Estado</span>
            <Badge className={statusBadgeClasses[booking.status] || ''}>
              {bookingStatusLabel(booking.status)}
            </Badge>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">{vocabulary.Client}</span>
            <span className="text-sm font-medium">{booking.customer?.name || '—'}</span>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Pagado</span>
            <span className="flex items-center gap-2 text-sm font-medium">
              <PaymentRevertedBadge paymentStatus={booking.paymentStatus} />
              {formatManualPaymentMoney(booking.depositPaid, businessCurrency)}
            </span>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Total</span>
            <span className="text-sm font-medium">
              {formatManualPaymentMoney(booking.finalAmount, businessCurrency)}
            </span>
          </div>

          {booking.remainingBalance > 0 && (
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Saldo pendiente</span>
              <span className="text-sm font-semibold text-destructive">
                {formatManualPaymentMoney(booking.remainingBalance, businessCurrency)}
              </span>
            </div>
          )}

          {(() => {
            const where = bookingWhere(booking)
            return (
              <div className="flex items-start justify-between gap-4">
                <span className="text-sm text-muted-foreground">Dónde</span>
                <span className="min-w-0 text-right text-sm font-medium">
                  {where.label}
                  {where.detail && (
                    <span className="mt-0.5 block break-words text-xs font-normal text-muted-foreground">
                      {where.isLink ? (
                        <a href={where.detail} target="_blank" rel="noopener noreferrer" className="underline">
                          {where.detail}
                        </a>
                      ) : where.detail}
                    </span>
                  )}
                </span>
              </div>
            )
          })()}

          {booking.customerNotes && (
            <div>
              <span className="text-sm text-muted-foreground">Notas del cliente</span>
              <p className="mt-1 text-sm">{booking.customerNotes}</p>
            </div>
          )}

          {/* Sólo mientras el drawer está abierto: monta, pide las fotos de ESTA
              reserva y se desmonta al cerrar. Así la agenda no carga fotos de
              todas las citas del mes para mostrar una. */}
          {open && (
            <div className="space-y-2 rounded-xl border border-border/60 p-3">
              <h4 className="text-sm font-semibold">Fotos de esta cita</h4>
              <CustomerPhotos
                target={{ bookingId: booking.id }}
                uploadEnabled={photoUploadEnabled}
                compact
              />
            </div>
          )}

          <div className="space-y-2 rounded-xl border border-border/60 p-3">
            <h4 className="text-sm font-semibold">Contactar cliente</h4>
            <BookingContactButtons
              booking={{
                bookingNumber: booking.bookingNumber,
                customerName: booking.customer?.name || '',
                customerPhone: booking.customer?.phone || null,
                serviceName: booking.service?.name || '',
                startDateTime: booking.startDateTime,
                businessTimezone,
                businessCurrency,
                totalPrice: booking.totalPrice || 0,
                depositPaid: booking.depositPaid || 0,
                remainingBalance: booking.remainingBalance || 0,
                businessAddress,
              }}
            />
            {!booking.customer?.phone && (
              <p className="text-xs text-muted-foreground">Sin teléfono registrado</p>
            )}
          </div>

          {isManualPaymentAllowed(booking) && (
            <div className="space-y-3 rounded-xl border border-border/60 p-3">
              <h4 className="text-sm font-semibold">Registrar pago</h4>
              <ManualPaymentDialog
                bookings={[booking]}
                businessCurrency={businessCurrency || 'CLP'}
                defaultBookingId={booking.id}
                triggerClassName="w-full"
                triggerLabel="Abrir modal de pago"
              />
            </div>
          )}

          {booking.status === 'pending_confirmation' && (
            <div className="space-y-2 rounded-xl border border-border/60 p-3">
              <h4 className="text-sm font-semibold">Solicitud por responder</h4>
              <div className="flex gap-2">
                <BookingStatusButton
                  bookingId={booking.id}
                  status="confirmed"
                  label="Aceptar"
                  pendingLabel="Aceptando…"
                  errorLabel="Error al aceptar"
                  variant="default"
                  align="start"
                  className="w-full"
                />
                <div className="flex-1">
                  <CancelBookingButton bookingId={booking.id} mode="reject" label="Rechazar" size="sm" />
                </div>
              </div>
            </div>
          )}

          {(booking.status === 'confirmed' || booking.status === 'pending_payment') && (
            <div className="space-y-2 rounded-xl border border-border/60 p-3">
              <h4 className="text-sm font-semibold">Acciones</h4>
              <div className="flex gap-2">
                <Link href={`/dashboard/bookings/${booking.id}/reschedule`} className="flex-1">
                  <Button type="button" variant="outline" size="sm" className="w-full">
                    <RefreshCw className="mr-1 size-3" />
                    Reprogramar
                  </Button>
                </Link>
                <div className="flex-1">
                  <CancelBookingButton bookingId={booking.id} size="sm" />
                </div>
              </div>
            </div>
          )}
        </div>

        <SheetFooter className="p-4">
          <Button variant="outline" onClick={() => onOpenChange(false)} className="w-full">
            Cerrar
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
