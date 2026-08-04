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
import { StatusBadge } from '@/components/ui/status-badge'
import type { CalendarBooking } from './booking-card'
import { BookingContactButtons } from './booking-contact-buttons'
import { CancelBookingButton } from './cancel-booking-button'
import { BookingStatusButton } from './booking-status-button'
import { RefreshCw } from 'lucide-react'
import { ManualPaymentDialog } from './manual-payment-dialog'
import { formatManualPaymentMoney, isManualPaymentAllowed, manualPaymentBlockedReason } from './manual-payment-utils'
import { PaymentRevertedBadge } from './payment-reverted-badge'
import { CustomerPhotos } from './customer-photos'
import { ReassignControl } from './reassign-control'
import { displayedBookingStatus, isTerminalBookingStatus } from '@/lib/bookings/status-labels'
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

interface BookingDrawerProps {
  booking: CalendarBooking
  open: boolean
  onOpenChange: (open: boolean) => void
  businessCurrency: string
  businessTimezone: string
  businessAddress: string | null
  photoUploadEnabled: boolean
  /** Si el negocio tiene gente ACTIVA. Requerido: gobierna si aparece el
   *  control de reasignar, y opcional lo dejaría siempre apagado sin error de
   *  compilación (mismo argumento que `professional` en CalendarBooking). */
  hasTeam: boolean
}

export function BookingDrawer({ booking, open, onOpenChange, businessCurrency, businessTimezone, businessAddress, photoUploadEnabled, hasTeam }: BookingDrawerProps) {
  const vocabulary = useVocabulary()
  const isMobile = useIsMobile()

  const start = new Date(booking.startDateTime)
  // En un estado terminal no hay nada que reasignar (el server también lo
  // rechaza; esto sólo evita ofrecer un botón que va a fallar).
  const reassignable = hasTeam && !isTerminalBookingStatus(booking.status)
  const paymentBlockedReason = manualPaymentBlockedReason(booking)

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
            {/* Status DERIVADO, no el crudo: el bloque de cobro de más abajo
                dice "venció el plazo", y un badge naranja de "Pendiente de
                pago" arriba lo contradice. Las DECISIONES (reasignar,
                cancelar, aceptar) siguen mirando el asentado, que es contra el
                que decide el server. */}
            <StatusBadge status={displayedBookingStatus(booking)} />
          </div>

          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">{vocabulary.Client}</span>
            <span className="text-sm font-medium">{booking.customer?.name || '—'}</span>
          </div>

          {/* Sin persona Y sin equipo no hay fila (label invariable, misma
              decisión que los emails); con equipo la fila aparece aunque la
              cita no tenga a nadie, porque asignarla es parte del control. */}
          {(booking.professional || reassignable) && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Atiende</span>
                <span className="text-sm font-medium">{booking.professional?.name ?? '—'}</span>
              </div>
              {reassignable && (
                <div className="flex justify-end">
                  <ReassignControl
                    bookingId={booking.id}
                    currentName={booking.professional?.name ?? null}
                    onReassigned={() => onOpenChange(false)}
                  />
                </div>
              )}
            </div>
          )}

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
                      {where.href ? (
                        <a href={where.href} target="_blank" rel="noopener noreferrer" className="underline">
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

          {/* Sin `initialPhotos`, el panel pide las fotos de ESTA reserva al
              montarse. Sólo monta con el drawer abierto (el SheetContent de
              Radix desmonta al cerrar), así que la agenda no carga fotos de
              todas las citas del mes para mostrar una. */}
          <div className="space-y-2 rounded-xl border border-border/60 p-3">
            <h4 className="text-sm font-semibold">Fotos de esta cita</h4>
            <CustomerPhotos
              target={{ bookingId: booking.id }}
              uploadEnabled={photoUploadEnabled}
              compact
            />
          </div>

          <div className="space-y-2 rounded-xl border border-border/60 p-3">
            <h4 className="text-sm font-semibold">Contactar cliente</h4>
            <BookingContactButtons
              booking={{
                bookingNumber: booking.bookingNumber,
                customerName: booking.customer?.name || '',
                customerPhone: booking.customer?.phone || null,
                serviceName: booking.service?.name || '',
                professionalName: booking.professional?.name ?? null,
                startDateTime: booking.startDateTime,
                businessTimezone,
                businessCurrency,
                totalPrice: booking.totalPrice || 0,
                depositPaid: booking.depositPaid || 0,
                remainingBalance: booking.remainingBalance || 0,
                modality: booking.modality,
                serviceAddress: booking.serviceAddress,
                meetingUrl: booking.meetingUrl,
                businessAddress,
              }}
            />
            {!booking.customer?.phone && (
              <p className="text-xs text-muted-foreground">Sin teléfono registrado</p>
            )}
          </div>

          {isManualPaymentAllowed(booking) ? (
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
          ) : paymentBlockedReason ? (
            // El bloque no desaparece: dice por qué. Y no sobra con el badge de
            // arriba — éste espeja el guard del server (`assertBookingPayable`,
            // que no mira los pagos), así que con una transferencia declarada
            // el badge sigue diciendo "Pendiente de pago" y esta línea es lo
            // único que avisa. Además nombra la SALIDA (esperar al cron y usar
            // Revivir), que un badge no puede explicar.
            <div className="space-y-1 rounded-xl border border-border/60 p-3">
              <h4 className="text-sm font-semibold">Registrar pago</h4>
              <p className="text-sm text-muted-foreground">{paymentBlockedReason}</p>
            </div>
          ) : null}

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
