'use client'

import { useState, useTransition, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { format } from 'date-fns'
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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { createManualPayment } from '@/server/actions/payments'
import type { CalendarBooking } from './booking-card'
import { BookingContactButtons } from './booking-contact-buttons'
import { CancelBookingButton } from './cancel-booking-button'
import { RefreshCw } from 'lucide-react'

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

interface BookingDrawerProps {
  booking: CalendarBooking
  open: boolean
  onOpenChange: (open: boolean) => void
  businessCurrency: string
  businessTimezone: string
  businessAddress: string | null
}

export function BookingDrawer({ booking, open, onOpenChange, businessCurrency, businessTimezone, businessAddress }: BookingDrawerProps) {
  const isMobile = useIsMobile()
  const [amount, setAmount] = useState('')
  const [paymentMethod, setPaymentMethod] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const router = useRouter()

  const start = new Date(booking.startDateTime)

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    const numAmount = Number(amount)
    if (!numAmount || numAmount <= 0) {
      setError('Monto inválido')
      return
    }
    if (!paymentMethod) {
      setError('Selecciona un método de pago')
      return
    }

    startTransition(async () => {
      try {
        await createManualPayment({
          bookingId: booking.id,
          amount: numAmount,
          currency: businessCurrency || 'CLP',
          paymentMethod,
        })
        router.refresh()
        setAmount('')
        setPaymentMethod('')
        onOpenChange(false)
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Error al registrar pago'
        setError(message)
      }
    })
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side={isMobile ? 'bottom' : 'right'} className="h-auto max-h-[85vh] sm:max-h-full">
        <SheetHeader>
          <SheetTitle>Detalle de reserva</SheetTitle>
          <SheetDescription>
            {booking.service?.name} — {format(start, "EEEE d 'de' MMMM, HH:mm", { locale: es })}
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-4 overflow-y-auto p-4">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Estado</span>
            <Badge className={statusBadgeClasses[booking.status] || ''}>
              {statusLabels[booking.status] || booking.status}
            </Badge>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Cliente</span>
            <span className="text-sm font-medium">{booking.customer?.name || '—'}</span>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Pagado</span>
            <span className="text-sm font-medium">
              ${booking.depositPaid.toLocaleString('es-CL')} {businessCurrency}
            </span>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Total</span>
            <span className="text-sm font-medium">
              ${booking.finalAmount.toLocaleString('es-CL')} {businessCurrency}
            </span>
          </div>

          {booking.remainingBalance > 0 && (
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Saldo pendiente</span>
              <span className="text-sm font-semibold text-destructive">
                ${booking.remainingBalance.toLocaleString('es-CL')} {businessCurrency}
              </span>
            </div>
          )}

          {booking.customerNotes && (
            <div>
              <span className="text-sm text-muted-foreground">Notas del cliente</span>
              <p className="mt-1 text-sm">{booking.customerNotes}</p>
            </div>
          )}

          <div className="space-y-2 rounded-xl border border-border/60 p-3">
            <h4 className="text-sm font-semibold">Contactar clienta</h4>
            <BookingContactButtons
              booking={{
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

          {booking.remainingBalance > 0 && booking.status === 'confirmed' && (
            <form onSubmit={handleSubmit} className="space-y-3 rounded-xl border border-border/60 p-3">
              <h4 className="text-sm font-semibold">Registrar pago</h4>
              <div>
                <Label htmlFor="amount">Monto</Label>
                <Input
                  id="amount"
                  type="number"
                  min={1}
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder={`Máx ${booking.remainingBalance}`}
                />
              </div>
              <div>
                <Label htmlFor="method">Método</Label>
                <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                  <SelectTrigger id="method">
                    <SelectValue placeholder="Selecciona método" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="efectivo">Efectivo</SelectItem>
                    <SelectItem value="transferencia">Transferencia</SelectItem>
                    <SelectItem value="tarjeta">Tarjeta</SelectItem>
                    <SelectItem value="otro">Otro</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {error && <p className="text-xs text-destructive">{error}</p>}
              <Button type="submit" disabled={isPending} className="w-full">
                {isPending ? 'Registrando...' : 'Registrar pago'}
              </Button>
            </form>
          )}

          {(booking.status === 'confirmed' || booking.status === 'pending_payment') && (
            <div className="space-y-2 rounded-xl border border-border/60 p-3">
              <h4 className="text-sm font-semibold">Acciones</h4>
              <div className="flex gap-2">
                <a href={`/dashboard/bookings/${booking.id}/reschedule`} className="flex-1">
                  <Button type="button" variant="outline" size="sm" className="w-full">
                    <RefreshCw className="mr-1 size-3" />
                    Reprogramar
                  </Button>
                </a>
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
