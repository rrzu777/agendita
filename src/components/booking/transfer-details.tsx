'use client'

import { Button } from '@/components/ui/button'
import { formatMoney } from '@/lib/money'
import { formatBookingDateTime } from '@/lib/booking/format-booking-datetime'
import type { BankTransferPublicInfo } from '@/lib/bank-transfer/public-info'

/** Datos bancarios + botón "Ya transferí". Presentacional puro: lo usan el
 *  paso de pago del wizard y el panel de /book/confirmation. */
export function TransferDetails({
  bank,
  amount,
  deadline,
  timezone,
  declaring,
  onDeclare,
  kind = 'deposit',
}: {
  bank: BankTransferPublicInfo
  amount: number
  deadline: Date | null
  timezone: string
  declaring: boolean
  onDeclare: () => void
  /** 'balance' = saldo restante: cambia el label del monto (sin plazo — deadline ya es null en ese caso). */
  kind?: 'deposit' | 'balance'
}) {
  const rows: Array<[string, string]> = [
    ['Titular', bank.accountHolder],
    ['RUT', bank.rut],
    ['Banco', bank.bankName],
    ['Tipo de cuenta', bank.accountType],
    ['Número de cuenta', bank.accountNumber],
  ]
  if (bank.email) rows.push(['Email', bank.email])

  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-muted/55 p-5">
        <p className="mb-3 text-sm text-muted-foreground">
          Transferí el {kind === 'balance' ? 'saldo' : 'abono'} de <span className="font-semibold text-primary">{formatMoney(amount)}</span> a esta cuenta:
        </p>
        <div className="space-y-2 text-sm">
          {rows.map(([label, value]) => (
            <div key={label} className="flex justify-between gap-4">
              <span className="text-muted-foreground">{label}</span>
              <span className="font-semibold text-primary">{value}</span>
            </div>
          ))}
        </div>
        {bank.instructions && (
          <p className="mt-3 rounded-lg bg-background/70 p-3 text-sm text-muted-foreground">{bank.instructions}</p>
        )}
      </div>

      {deadline && (
        <p className="text-sm text-muted-foreground">
          Tenés hasta el <span className="font-semibold text-primary">{formatBookingDateTime(deadline, timezone)}</span> para
          transferir y avisarnos. Después de eso el horario se libera.
        </p>
      )}

      <Button className="h-12 w-full rounded-full text-base font-semibold" onClick={onDeclare} disabled={declaring}>
        {declaring ? 'Avisando…' : 'Ya transferí'}
      </Button>
    </div>
  )
}
