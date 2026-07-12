'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { FileText, Landmark, MessageCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { buildWhatsappUrl } from '@/lib/notifications'
import { rejectBankTransfer } from '@/server/actions/bank-transfer-verify'
import { formatManualPaymentMoney as formatMoney } from './manual-payment-utils'
import { VerifyTransferDialog } from './verify-transfer-dialog'

export type PendingTransferKind = 'deposit' | 'balance'

export interface PendingTransferItem {
  paymentId: string
  bookingId: string
  customerName: string
  customerPhone: string | null
  serviceName: string
  startDateTime: Date
  amount: number
  declaredAt: Date
  kind: PendingTransferKind
  proofKey: string | null
  proofContentType: string | null
}

const KIND_BADGE_CLASS =
  'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold shrink-0'

function KindBadge({ kind }: { kind: PendingTransferKind }) {
  if (kind === 'balance') {
    return (
      <span className={`${KIND_BADGE_CLASS} bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300`}>
        Saldo
      </span>
    )
  }
  return (
    <span className={`${KIND_BADGE_CLASS} bg-orange-100 text-orange-800 dark:bg-orange-500/15 dark:text-orange-300`}>
      Abono
    </span>
  )
}

function timeAgo(declaredAt: Date): string {
  const diffMs = Date.now() - new Date(declaredAt).getTime()
  const minutes = Math.max(0, Math.floor(diffMs / 60_000))
  if (minutes < 60) return `hace ${minutes} min`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `hace ${hours} h`
  const days = Math.floor(hours / 24)
  return `hace ${days} d`
}

function PendingTransferRow({
  item,
  businessCurrency,
  businessTimezone,
}: {
  item: PendingTransferItem
  businessCurrency: string
  businessTimezone: string
}) {
  const router = useRouter()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [isPending, startTransition] = useTransition()

  const dateStr = new Date(item.startDateTime).toLocaleDateString('es-CL', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: businessTimezone,
  })
  const timeStr = new Date(item.startDateTime).toLocaleTimeString('es-CL', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: businessTimezone,
  })

  const whatsappUrl = item.customerPhone
    ? buildWhatsappUrl(
      item.customerPhone,
      item.kind === 'balance'
        ? `Hola ${item.customerName}, recibimos tu comprobante de transferencia del saldo por ${item.serviceName}. Estamos verificando el pago.`
        : `Hola ${item.customerName}, recibimos tu comprobante de transferencia por ${item.serviceName}. Estamos verificando el pago.`,
    )
    : null

  function handleReject() {
    const confirmMessage = item.kind === 'balance'
      ? '¿Rechazar esta transferencia del saldo? La reserva NO se cancela; la clienta podrá volver a avisar.'
      : '¿Rechazar esta transferencia? Se cancelará la reserva.'
    if (!window.confirm(confirmMessage)) return
    startTransition(async () => {
      try {
        await rejectBankTransfer(item.paymentId)
        router.refresh()
      } catch {
        // best-effort; el estado se refresca en el próximo render
        router.refresh()
      }
    })
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border/60 bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <p className="font-semibold text-primary truncate">{item.customerName}</p>
          <KindBadge kind={item.kind} />
        </div>
        <p className="text-sm text-muted-foreground truncate">
          {item.serviceName} · {dateStr}, {timeStr}
        </p>
        <p className="mt-1 text-sm">
          <span className="font-semibold text-primary">{formatMoney(item.amount, businessCurrency)}</span>
          <span className="text-muted-foreground"> · declarado {timeAgo(item.declaredAt)}</span>
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {item.proofKey && (
          <a
            href={`/dashboard/transfers/proof/${item.paymentId}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            <Button type="button" variant="outline" size="sm" className="h-9 font-semibold">
              <FileText className="mr-1 size-4" />
              Ver comprobante
            </Button>
          </a>
        )}
        {whatsappUrl && (
          <a href={whatsappUrl} target="_blank" rel="noopener noreferrer">
            <Button type="button" variant="outline" size="sm" className="h-9 font-semibold">
              <MessageCircle className="mr-1 size-4" />
              WhatsApp
            </Button>
          </a>
        )}
        <Button
          type="button"
          size="sm"
          className="h-9 font-semibold"
          onClick={() => setDialogOpen(true)}
          disabled={isPending}
        >
          Verificar
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-9 font-semibold text-destructive hover:text-destructive"
          onClick={handleReject}
          disabled={isPending}
        >
          Rechazar
        </Button>
      </div>

      <VerifyTransferDialog
        paymentId={item.paymentId}
        defaultAmount={item.amount}
        businessCurrency={businessCurrency}
        kind={item.kind}
        proofKey={item.proofKey}
        proofContentType={item.proofContentType}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
      />
    </div>
  )
}

export function PendingTransfersSection({
  items,
  businessCurrency,
  businessTimezone,
}: {
  items: PendingTransferItem[]
  businessCurrency: string
  businessTimezone: string
}) {
  if (items.length === 0) return null

  return (
    <section className="studio-card p-5">
      <div className="mb-4 flex items-center gap-2">
        <Landmark className="size-5 text-orange-600 dark:text-orange-400" />
        <h2 className="text-lg font-semibold text-primary">Transferencias por verificar</h2>
        <span className="rounded-full bg-orange-100 px-2 py-0.5 text-xs font-semibold text-orange-800 dark:bg-orange-500/15 dark:text-orange-300">
          {items.length}
        </span>
      </div>
      <div className="space-y-3">
        {items.map((item) => (
          <PendingTransferRow
            key={item.paymentId}
            item={item}
            businessCurrency={businessCurrency}
            businessTimezone={businessTimezone}
          />
        ))}
      </div>
    </section>
  )
}
