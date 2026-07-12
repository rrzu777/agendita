'use client'

import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle2, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { confirmBankTransfer, rejectBankTransfer } from '@/server/actions/bank-transfer-verify'
import { formatManualPaymentMoney as formatMoney } from './manual-payment-utils'
import type { PendingTransferKind } from './pending-transfers-section'

export function VerifyTransferDialog({
  paymentId,
  defaultAmount,
  businessCurrency,
  kind = 'deposit',
  proofKey,
  proofContentType,
  open,
  onOpenChange,
}: {
  paymentId: string
  defaultAmount: number
  businessCurrency: string
  kind?: PendingTransferKind
  proofKey?: string | null
  proofContentType?: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const proofUrl = proofKey ? `/dashboard/transfers/proof/${paymentId}` : null
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
    const confirmMessage = kind === 'balance'
      ? '¿Rechazar esta transferencia del saldo? La reserva NO se cancela; la clienta podrá volver a avisar.'
      : '¿Rechazar esta transferencia? Se cancelará la reserva.'
    if (!window.confirm(confirmMessage)) return
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
            {kind === 'balance' ? 'Verificar transferencia del saldo' : 'Verificar transferencia'}
          </DialogTitle>
          <DialogDescription>
            Confirma el monto que recibiste. Podés ajustarlo si el cliente transfirió una cantidad distinta.
          </DialogDescription>
        </DialogHeader>

        {proofUrl && (
          <div className="mb-4">
            {proofContentType?.startsWith('image/') ? (
              // eslint-disable-next-line @next/next/no-img-element -- URL efímera presignada (60s) desde bucket R2 privado; next/image no aplica
              <img
                src={proofUrl}
                alt="Comprobante"
                className="rounded-lg border border-border/60"
                style={{ maxWidth: '100%' }}
              />
            ) : (
              <a href={proofUrl} target="_blank" rel="noopener noreferrer">
                <Button type="button" variant="outline" className="h-10 font-semibold">
                  Ver comprobante (PDF)
                </Button>
              </a>
            )}
          </div>
        )}

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
