'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { CreditCard, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { createManualPayment } from '@/server/actions/payments'
import {
  calculateManualPaymentAmount,
  getManualPaymentSuggestion,
  isManualPaymentAllowed,
  type ManualPaymentBooking,
  type ManualPaymentMode,
} from './manual-payment-utils'

const PAYMENT_METHODS = ['Efectivo', 'Transferencia', 'Tarjeta', 'Mercado Pago'] as const
const OTHER = 'Otro'

function formatMoney(amount: number, currency: string) {
  return `$${amount.toLocaleString('es-CL')} ${currency}`
}

export function ManualPaymentDialog({
  bookings,
  businessCurrency = 'CLP',
  defaultBookingId,
  triggerClassName,
  triggerLabel = 'Registrar pago',
  triggerSize,
  triggerVariant,
}: {
  bookings: ManualPaymentBooking[]
  businessCurrency?: string
  defaultBookingId?: string
  triggerClassName?: string
  triggerLabel?: string
  triggerSize?: React.ComponentProps<typeof Button>['size']
  triggerVariant?: React.ComponentProps<typeof Button>['variant']
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [bookingId, setBookingId] = useState(defaultBookingId || '')
  const [mode, setMode] = useState<ManualPaymentMode>('fixed')
  const [fixedAmount, setFixedAmount] = useState('')
  const [percentage, setPercentage] = useState('50')
  const [method, setMethod] = useState<string>(PAYMENT_METHODS[0])
  const [otherMethod, setOtherMethod] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const payableBookings = useMemo(() => bookings.filter(isManualPaymentAllowed), [bookings])
  const selectedBooking = payableBookings.find((booking) => booking.id === bookingId) || null
  const suggestion = selectedBooking ? getManualPaymentSuggestion(selectedBooking) : null
  const parsedValue = mode === 'percentage' ? Number(percentage) : Number(fixedAmount)
  const amount = selectedBooking
    ? calculateManualPaymentAmount({
      mode,
      value: parsedValue,
      remainingBalance: selectedBooking.remainingBalance,
    })
    : 0

  function selectBooking(nextBookingId: string) {
    setBookingId(nextBookingId)
    const nextBooking = payableBookings.find((booking) => booking.id === nextBookingId)
    setFixedAmount(nextBooking ? String(getManualPaymentSuggestion(nextBooking).amount) : '')
    setMode('fixed')
    setError(null)
  }

  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen)
    if (nextOpen) {
      selectBooking(defaultBookingId || payableBookings[0]?.id || '')
    }
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)

    if (!selectedBooking) {
      setError('Selecciona una reserva')
      return
    }
    if (amount <= 0) {
      setError('Ingresa un monto válido')
      return
    }
    const paymentMethod = method === OTHER ? otherMethod.trim() : method
    if (!paymentMethod) {
      setError('Selecciona un método de pago')
      return
    }

    startTransition(async () => {
      try {
        await createManualPayment({
          bookingId: selectedBooking.id,
          amount,
          currency: businessCurrency,
          paymentMethod,
        })
        setOpen(false)
        router.refresh()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Error al registrar pago')
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button
          type="button"
          size={triggerSize}
          variant={triggerVariant}
          className={triggerClassName || 'h-11 font-semibold'}
        >
          <Plus className="mr-2 size-4" />
          {triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-2xl font-heading font-semibold tracking-tight text-primary">
            Registrar pago manual
          </DialogTitle>
          <DialogDescription>
            Registra un monto fijo o un porcentaje calculado sobre el saldo pendiente de la reserva.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="space-y-2">
            <Label className="studio-eyebrow">Reserva</Label>
            <select
              value={bookingId}
              onChange={(e) => selectBooking(e.target.value)}
              required
              disabled={Boolean(defaultBookingId)}
              className="min-h-12 w-full rounded-lg border border-border bg-card px-4 text-base focus:border-primary focus:outline-none disabled:opacity-70"
            >
              <option value="">Selecciona una reserva</option>
              {payableBookings.map((booking) => (
                <option key={booking.id} value={booking.id}>
                  {booking.customer?.name ? `${booking.customer.name} - ` : `Reserva ${booking.id.slice(-4)} - `}
                  {formatMoney(booking.remainingBalance, businessCurrency)} pendiente
                </option>
              ))}
            </select>
          </div>

          {selectedBooking && suggestion && (
            <div className="rounded-lg border border-border/70 bg-muted/40 p-3 text-sm">
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">Sugerencia</span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setMode('fixed')
                    setFixedAmount(String(suggestion.amount))
                  }}
                >
                  Usar {formatMoney(suggestion.amount, businessCurrency)}
                </Button>
              </div>
              <p className="mt-2 font-medium text-primary">{suggestion.label}</p>
              <p className="text-muted-foreground">
                Saldo pendiente: {formatMoney(selectedBooking.remainingBalance, businessCurrency)}
              </p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-2">
            <Button
              type="button"
              variant={mode === 'fixed' ? 'default' : 'outline'}
              onClick={() => setMode('fixed')}
            >
              Monto fijo
            </Button>
            <Button
              type="button"
              variant={mode === 'percentage' ? 'default' : 'outline'}
              onClick={() => setMode('percentage')}
            >
              Porcentaje
            </Button>
          </div>

          {mode === 'fixed' ? (
            <div className="space-y-2">
              <Label className="studio-eyebrow" htmlFor="manual-payment-amount">Monto ({businessCurrency})</Label>
              <Input
                id="manual-payment-amount"
                className="studio-input"
                type="number"
                min={1}
                max={selectedBooking?.remainingBalance}
                value={fixedAmount}
                onChange={(e) => setFixedAmount(e.target.value)}
                required
              />
            </div>
          ) : (
            <div className="space-y-2">
              <Label className="studio-eyebrow" htmlFor="manual-payment-percentage">Porcentaje del saldo pendiente</Label>
              <Input
                id="manual-payment-percentage"
                className="studio-input"
                type="number"
                min={1}
                max={100}
                value={percentage}
                onChange={(e) => setPercentage(e.target.value)}
                required
              />
              <p className="text-sm text-muted-foreground">
                Equivale a {formatMoney(amount, businessCurrency)}
              </p>
            </div>
          )}

          <div className="space-y-2">
            <Label className="studio-eyebrow">Método de pago</Label>
            <select
              value={method}
              onChange={(e) => setMethod(e.target.value)}
              className="min-h-12 w-full rounded-lg border border-border bg-card px-4 text-base focus:border-primary focus:outline-none"
            >
              {PAYMENT_METHODS.map((paymentMethod) => (
                <option key={paymentMethod} value={paymentMethod}>{paymentMethod}</option>
              ))}
              <option value={OTHER}>{OTHER}...</option>
            </select>
            {method === OTHER && (
              <Input
                className="studio-input"
                value={otherMethod}
                onChange={(e) => setOtherMethod(e.target.value)}
                placeholder="Especifica el método"
                required
              />
            )}
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <Button type="submit" className="h-12 w-full font-semibold" disabled={isPending || !selectedBooking}>
            <CreditCard className="mr-2 size-4" />
            {isPending ? 'Registrando...' : `Registrar ${formatMoney(amount, businessCurrency)}`}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}
