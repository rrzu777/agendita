'use client'

import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle2, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { confirmBankTransfer, rejectBankTransfer } from '@/server/actions/bank-transfer-verify'

function formatMoney(amount: number, currency: string) {
  return `$${amount.toLocaleString('es-CL')} ${currency}`
}

export function VerifyTransferDialog({
  paymentId,
  defaultAmount,
  businessCurrency,
  open,
  onOpenChange,
}: {
  paymentId: string
  defaultAmount: number
  businessCurrency: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const router = useRouter()
  const [amount, setAmount] = useState(String(defaultAmount))
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function resetForm() {
    setAmount(String(defaultAmount))
    setError(null)
  }

  // Re-prefill the amount and clear errors every time the dialog opens so a
  // parent-controlled reopen (per-row) starts from the declared amount. Resets
  // go through resetForm() so the direct-setState-in-effect rule stays quiet
  // (same shape as manual-payment-dialog's selectBooking-on-open).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- re-prefilling on open is required so parent-controlled per-row opens start from the declared amount
    if (open) resetForm()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  function handleConfirm(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    const parsed = Number(amount)
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setError('Ingresa un monto válido')
      return
    }
    startTransition(async () => {
      try {
        await confirmBankTransfer(paymentId, parsed)
        onOpenChange(false)
        router.refresh()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Error al verificar el pago')
      }
    })
  }

  function handleReject() {
    setError(null)
    if (!window.confirm('¿Rechazar esta transferencia? Se cancelará la reserva.')) return
    startTransition(async () => {
      try {
        await rejectBankTransfer(paymentId)
        onOpenChange(false)
        router.refresh()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Error al rechazar el pago')
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-2xl font-heading font-semibold tracking-tight text-primary">
            Verificar transferencia
          </DialogTitle>
          <DialogDescription>
            Confirma el monto que recibiste. Podés ajustarlo si el cliente transfirió una cantidad distinta.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleConfirm} className="space-y-5">
          <div className="space-y-2">
            <Label className="studio-eyebrow" htmlFor="verify-transfer-amount">Monto recibido ({businessCurrency})</Label>
            <Input
              id="verify-transfer-amount"
              className="studio-input"
              type="number"
              min={1}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              required
            />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="flex flex-col gap-2 sm:flex-row-reverse">
            <Button type="submit" className="h-11 font-semibold sm:flex-1" disabled={isPending}>
              <CheckCircle2 className="mr-2 size-4" />
              {isPending ? 'Procesando...' : `Verificar ${formatMoney(Number(amount) || 0, businessCurrency)}`}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="h-11 font-semibold text-destructive hover:text-destructive sm:flex-1"
              disabled={isPending}
              onClick={handleReject}
            >
              <XCircle className="mr-2 size-4" />
              Rechazar
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
