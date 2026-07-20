'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { TransferDetails } from '@/components/booking/transfer-details'
import { declareBankTransfer, declareBalanceTransfer } from '@/server/actions/bank-transfer-public'
import type { BankTransferPublicInfo } from '@/lib/bank-transfer/public-info'

/** Superficie ACTIVA de /book/confirmation: la clienta que cerró la pestaña
 *  del wizard puede ver los datos bancarios y declarar desde acá.
 *  kind='balance' reusa el mismo panel para el saldo restante (feature #3). */
export function TransferPanel({ bank, amount, deadline, timezone, bookingId, kind = 'deposit' }: {
  bank: BankTransferPublicInfo
  amount: number
  deadline: Date | null
  timezone: string
  bookingId: string
  kind?: 'deposit' | 'balance'
}) {
  const router = useRouter()
  const [declaring, setDeclaring] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleDeclare(proof: { proofKey: string; proofContentType: string } | null) {
    setDeclaring(true)
    setError(null)
    const res = await (kind === 'balance' ? declareBalanceTransfer(bookingId, proof ?? {}) : declareBankTransfer(bookingId, proof ?? {}))
    if (!res.ok) {
      setError(res.error)
      setDeclaring(false)
      return
    }
    router.refresh()
    setDeclaring(false)
  }

  return (
    <div className="mb-8">
      <TransferDetails bank={bank} amount={amount} deadline={deadline} timezone={timezone} declaring={declaring} onDeclare={handleDeclare} kind={kind} bookingId={bookingId} />
      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
    </div>
  )
}
