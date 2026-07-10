'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { TransferDetails } from '@/components/booking/transfer-details'
import { declareBankTransfer } from '@/server/actions/bank-transfer-public'
import type { BankTransferPublicInfo } from '@/lib/bank-transfer/public-info'

/** Superficie ACTIVA de /book/confirmation: la clienta que cerró la pestaña
 *  del wizard puede ver los datos bancarios y declarar desde acá. */
export function TransferPanel({ bank, amount, deadline, timezone, bookingId }: {
  bank: BankTransferPublicInfo
  amount: number
  deadline: Date | null
  timezone: string
  bookingId: string
}) {
  const router = useRouter()
  const [declaring, setDeclaring] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleDeclare() {
    setDeclaring(true)
    setError(null)
    try {
      await declareBankTransfer(bookingId)
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No pudimos registrar tu aviso')
    } finally {
      setDeclaring(false)
    }
  }

  return (
    <div className="mb-8">
      <TransferDetails bank={bank} amount={amount} deadline={deadline} timezone={timezone} declaring={declaring} onDeclare={handleDeclare} />
      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
    </div>
  )
}
