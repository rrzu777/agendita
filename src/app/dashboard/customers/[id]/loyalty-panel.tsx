'use client'

import { useState, useTransition } from 'react'
import { adjustCustomerPoints, redeemPointsAsOwner } from '@/server/actions/loyalty'
import { loyaltyReasonLabel, displayBalance, canAfford } from '@/lib/loyalty/view'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { LoyaltyLedger } from '@prisma/client'

export function LoyaltyPanel({
  customerId,
  balance,
  history,
  label,
  catalog,
  grants,
}: {
  customerId: string
  balance: number
  history: Array<Pick<LoyaltyLedger, 'id' | 'points' | 'reason' | 'note' | 'createdAt'>>
  label: string
  catalog: Array<{ id: string; name: string; pointsCost: number | null }>
  grants: Array<{ id: string; code: string; expiresAt: Date | null; promotion: { name: string } }>
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

  function onRedeem(optionId: string) {
    setError(null)
    const requestId = crypto.randomUUID()
    startTransition(async () => {
      try {
        await redeemPointsAsOwner(customerId, optionId, requestId)
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

      {catalog.length > 0 && (
        <div className="mt-4">
          <h4 className="text-sm font-semibold text-primary">Canjear recompensa</h4>
          <ul className="mt-2 space-y-1">
            {catalog.map((o) => (
              <li key={o.id} className="flex items-center justify-between text-sm">
                <span>{o.name} · {o.pointsCost} {label}</span>
                <Button
                  size="sm"
                  disabled={isPending || !canAfford(balance, o.pointsCost ?? 0)}
                  onClick={() => onRedeem(o.id)}
                >
                  Canjear
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {grants.length > 0 && (
        <div className="mt-4">
          <h4 className="text-sm font-semibold text-primary">Recompensas activas</h4>
          <ul className="mt-2 space-y-1 text-sm">
            {grants.map((g) => (
              <li key={g.id} className="flex items-center justify-between">
                <span>
                  {g.promotion.name} — <code className="font-mono">{g.code}</code>
                </span>
                {g.expiresAt && (
                  <span className="text-xs text-muted-foreground">
                    vence {new Intl.DateTimeFormat('es', { day: '2-digit', month: 'short' }).format(new Date(g.expiresAt))}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

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
