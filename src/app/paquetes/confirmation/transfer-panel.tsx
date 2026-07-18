'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { PackageTransferInstructions } from '@/components/packages/package-transfer-instructions'
import { declarePackageTransfer } from '@/server/actions/packages-checkout'
import type { BankTransferPublicInfo } from '@/lib/bank-transfer/public-info'

/** Superficie ACTIVA de /paquetes/confirmation: la clienta que cerró la pestaña
 *  del wizard (o cuya compra expiró y sigue retomable) ve los datos bancarios y
 *  declara desde acá. En expired, declarar REVIVE la compra (server-side). */
export function PackageTransferPanel({ transferInfo, amount, currency, purchaseId }: {
  transferInfo: BankTransferPublicInfo
  amount: number
  currency: string
  purchaseId: string
}) {
  const router = useRouter()
  const [declaring, setDeclaring] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleDeclare() {
    setDeclaring(true)
    setError(null)
    try {
      await declarePackageTransfer({ purchaseId })
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No pudimos registrar tu aviso')
      setDeclaring(false)
    }
  }

  return (
    <div className="mt-6">
      <PackageTransferInstructions
        transferInfo={transferInfo}
        amount={amount}
        currency={currency}
        declaring={declaring}
        onDeclare={handleDeclare}
      />
      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
    </div>
  )
}
