'use client'

import { Button } from '@/components/ui/button'
import { formatMoney } from '@/lib/money'
import type { BankTransferPublicInfo } from '@/lib/bank-transfer/public-info'

// Vista de instrucciones de transferencia para paquetes, compartida por el wizard
// (package-checkout) y la confirmation activa (transfer-panel). NO reutiliza
// @/components/booking/transfer-details: esa está acoplada a reservas (deadline
// obligatorio, comprobante, copy de abono) y declarePackageTransfer es
// deliberadamente sin comprobante.
export function PackageTransferInstructions({
  transferInfo, amount, currency, declaring, onDeclare,
}: {
  transferInfo: BankTransferPublicInfo
  amount: number
  currency: string
  declaring: boolean
  onDeclare: () => void
}) {
  const rows: Array<[string, string]> = [
    ['Titular', transferInfo.accountHolder],
    ['RUT', transferInfo.rut],
    ['Banco', transferInfo.bankName],
    ['Tipo de cuenta', transferInfo.accountType],
    ['Número de cuenta', transferInfo.accountNumber],
  ]
  if (transferInfo.email) rows.push(['Email', transferInfo.email])
  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-muted/55 p-5">
        <p className="mb-3 text-sm text-muted-foreground">
          Transferí <span className="font-semibold text-primary">{formatMoney(amount, currency)}</span> a esta cuenta:
        </p>
        <div className="space-y-2 text-sm">
          {rows.map(([label, value]) => (
            <div key={label} className="flex justify-between gap-4">
              <span className="text-muted-foreground">{label}</span>
              <span className="font-semibold text-primary">{value}</span>
            </div>
          ))}
        </div>
        {transferInfo.instructions && (
          <p className="mt-3 rounded-lg bg-background/70 p-3 text-sm text-muted-foreground">{transferInfo.instructions}</p>
        )}
      </div>
      <Button className="h-12 w-full rounded-full text-base font-semibold" onClick={onDeclare} disabled={declaring}>
        {declaring ? 'Avisando…' : 'Ya transferí'}
      </Button>
    </div>
  )
}
