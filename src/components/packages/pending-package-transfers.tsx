'use client'

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Package } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { formatMoney } from '@/lib/money'
import { confirmPackageTransfer, rejectPackageTransfer } from '@/server/actions/bank-transfer-verify'

export interface PendingPackageTransferItem {
  paymentId: string
  purchaseId: string
  customerName: string
  productName: string
  amount: number
}

export function PendingPackageTransfers({ items, currency }: { items: PendingPackageTransferItem[]; currency: string }) {
  if (items.length === 0) return null
  return (
    <section className="mb-6 rounded-2xl border border-border/70 bg-card p-5 shadow-sm">
      <div className="mb-4 flex items-center gap-2">
        <Package className="size-5 text-warning" />
        <h2 className="text-lg font-semibold text-primary">Transferencias de paquete por verificar</h2>
        <span className="rounded-full bg-warning/10 px-2 py-0.5 text-xs font-semibold text-warning">{items.length}</span>
      </div>
      <div className="space-y-3">
        {items.map((item) => <PendingRow key={item.paymentId} item={item} currency={currency} />)}
      </div>
    </section>
  )
}

function PendingRow({ item, currency }: { item: PendingPackageTransferItem; currency: string }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [rejectOpen, setRejectOpen] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const rejectTriggerRef = useRef<HTMLButtonElement | null>(null)
  const confirmTriggerRef = useRef<HTMLButtonElement | null>(null)
  function onConfirm() {
    setError(null)
    startTransition(async () => {
      try {
        const result = await confirmPackageTransfer(item.paymentId)
        if (!result.ok) {
          setError(result.error)
          return
        }
        setConfirmOpen(false)
        router.refresh()
      } catch {
        setError('No pudimos confirmar la transferencia. Inténtalo nuevamente.')
      }
    })
  }
  function onReject() {
    setError(null)
    startTransition(async () => {
      try {
        const result = await rejectPackageTransfer(item.paymentId)
        if (!result.ok) {
          setError(result.error)
          return
        }
        setRejectOpen(false)
        router.refresh()
      } catch {
        setError('No pudimos rechazar la transferencia. Inténtalo nuevamente.')
      }
    })
  }
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border/60 bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="font-semibold text-primary truncate">{item.customerName}</p>
        <p className="text-sm text-muted-foreground truncate">{item.productName}</p>
        <p className="mt-1 text-sm"><span className="font-semibold text-primary">{formatMoney(item.amount, currency)}</span></p>
        {error && !rejectOpen && !confirmOpen && <p role="alert" className="mt-2 text-sm text-destructive">{error}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button ref={confirmTriggerRef} type="button" size="sm" className="min-h-11 font-semibold" onClick={() => { setError(null); setConfirmOpen(true) }} disabled={isPending}>Confirmar</Button>
        <Button ref={rejectTriggerRef} type="button" variant="outline" size="sm" className="min-h-11 font-semibold text-destructive hover:text-destructive" onClick={() => { setError(null); setRejectOpen(true) }} disabled={isPending}>Rechazar</Button>
      </div>

      <Dialog open={confirmOpen} onOpenChange={(open) => { if (!isPending) setConfirmOpen(open) }}>
        <DialogContent showCloseButton={false} onCloseAutoFocus={(event) => { event.preventDefault(); confirmTriggerRef.current?.focus() }}>
          <DialogHeader>
            <DialogTitle>Confirmar transferencia</DialogTitle>
            <DialogDescription>
              Confirma que recibiste {formatMoney(item.amount, currency)} de {item.customerName} por {item.productName}. Esto activará el paquete y registrará el pago.
            </DialogDescription>
          </DialogHeader>
          {error && <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <DialogClose asChild><Button type="button" size="form" variant="outline" className="min-h-11" disabled={isPending}>Volver</Button></DialogClose>
            <Button type="button" size="form" className="min-h-11" onClick={onConfirm} disabled={isPending}>{isPending ? 'Confirmando…' : 'Confirmar pago recibido'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={rejectOpen} onOpenChange={(open) => { if (!isPending) setRejectOpen(open) }}>
        <DialogContent
          showCloseButton={false}
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            rejectTriggerRef.current?.focus()
          }}
        >
          <DialogHeader>
            <DialogTitle>Rechazar transferencia</DialogTitle>
            <DialogDescription>
              La compra de {item.productName} quedará rechazada. Esta acción no confirma ningún pago.
            </DialogDescription>
          </DialogHeader>
          {error && <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" size="form" variant="outline" className="min-h-11" disabled={isPending}>Conservar transferencia</Button>
            </DialogClose>
            <Button type="button" size="form" variant="destructive" className="min-h-11" onClick={onReject} disabled={isPending}>
              {isPending ? 'Rechazando…' : 'Rechazar transferencia'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
