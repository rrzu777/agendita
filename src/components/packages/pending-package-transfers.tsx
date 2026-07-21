'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Package } from 'lucide-react'
import { Button } from '@/components/ui/button'
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
    <section className="studio-card mb-6 p-5">
      <div className="mb-4 flex items-center gap-2">
        <Package className="size-5 text-orange-600 dark:text-orange-400" />
        <h2 className="text-lg font-semibold text-primary">Transferencias de paquete por verificar</h2>
        <span className="rounded-full bg-orange-100 px-2 py-0.5 text-xs font-semibold text-orange-800 dark:bg-orange-500/15 dark:text-orange-300">{items.length}</span>
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
  function onConfirm() {
    // best-effort silencioso (ok o no): sin UI de error en esta fila, siempre refresca.
    startTransition(async () => { try { await confirmPackageTransfer(item.paymentId) } finally { router.refresh() } })
  }
  function onReject() {
    if (!window.confirm('¿Rechazar esta transferencia de paquete? La compra quedará rechazada.')) return
    // best-effort silencioso (ok o no): sin UI de error en esta fila, siempre refresca.
    startTransition(async () => { try { await rejectPackageTransfer(item.paymentId) } finally { router.refresh() } })
  }
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border/60 bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="font-semibold text-primary truncate">{item.customerName}</p>
        <p className="text-sm text-muted-foreground truncate">{item.productName}</p>
        <p className="mt-1 text-sm"><span className="font-semibold text-primary">{formatMoney(item.amount, currency)}</span></p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" className="h-9 font-semibold" onClick={onConfirm} disabled={isPending}>Confirmar</Button>
        <Button type="button" variant="outline" size="sm" className="h-9 font-semibold text-destructive hover:text-destructive" onClick={onReject} disabled={isPending}>Rechazar</Button>
      </div>
    </div>
  )
}
