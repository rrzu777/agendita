'use client'

import { useState, useTransition } from 'react'
import { adjustCustomerPoints } from '@/server/actions/loyalty'
import { loyaltyReasonLabel, displayBalance } from '@/lib/loyalty/view'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { LoyaltyLedger } from '@prisma/client'

export function LoyaltyPanel({
  customerId,
  balance,
  history,
  label,
}: {
  customerId: string
  balance: number
  history: Array<Pick<LoyaltyLedger, 'id' | 'points' | 'reason' | 'note' | 'createdAt'>>
  label: string
}) {
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function onAdjust(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    // Guardamos el form antes del async: dentro del callback e.currentTarget puede ser null.
    const form = e.currentTarget
    const fd = new FormData(form)
    const delta = Number(fd.get('delta') ?? 0)
    const note = String(fd.get('note') ?? '')
    startTransition(async () => {
      try {
        await adjustCustomerPoints(customerId, delta, note)
        form.reset()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Error')
      }
    })
  }

  return (
    <div className="studio-card p-4">
      <div className="flex items-baseline justify-between">
        <h3 className="text-lg font-semibold text-primary">Fidelización</h3>
        <span className="text-2xl font-semibold text-primary">
          {displayBalance(balance)}{' '}
          <span className="text-sm font-normal text-muted-foreground">{label}</span>
        </span>
      </div>

      <form onSubmit={onAdjust} className="mt-3 flex flex-wrap items-end gap-2">
        <Input name="delta" type="number" placeholder="±puntos" required className="w-28" />
        <Input name="note" type="text" placeholder="Motivo" required className="flex-1" />
        <Button type="submit" size="sm" disabled={isPending}>
          Ajustar
        </Button>
      </form>
      {error && <p className="mt-1 text-sm text-destructive">{error}</p>}

      {history.length > 0 && (
        <ul className="mt-3 divide-y divide-border/60">
          {history.map((h) => (
            <li key={h.id} className="flex items-center justify-between py-1.5 text-sm">
              <span className="text-muted-foreground">
                {loyaltyReasonLabel(h.reason)}
                {h.note ? ` · ${h.note}` : ''}
              </span>
              <span className={h.points >= 0 ? 'font-semibold text-green-700' : 'text-muted-foreground'}>
                {h.points >= 0 ? '+' : ''}
                {h.points}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
