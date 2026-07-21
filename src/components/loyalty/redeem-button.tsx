'use client'

import { useState, useTransition } from 'react'
import type { ActionResult } from '@/lib/actions/result'

/** Botón de canje de la tarjeta pública/`/mi`. Antes era un `<form action={redeemAction}>`
 *  nativo (sin JS) que dejaba propagar el throw; con ActionResult ya no hay excepción que
 *  mostrar vía el error boundary, así que necesitamos manejo cliente (useTransition) para
 *  mostrar `res.error` — mismo patrón que MarketingOptOutSection en este mismo árbol. */
export function RedeemButton({
  optionId,
  name,
  pointsCost,
  label,
  disabled,
  redeemAction,
}: {
  optionId: string
  name: string
  pointsCost: number | null
  label: string
  disabled: boolean
  redeemAction: (optionId: string, requestId: string) => Promise<ActionResult<void>>
}) {
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function onRedeem() {
    setError(null)
    const requestId = crypto.randomUUID()
    startTransition(async () => {
      try {
        const res = await redeemAction(optionId, requestId)
        if (!res.ok) { setError(res.error); return }
      } catch {
        setError('No se pudo canjear')
      }
    })
  }

  return (
    <li className="flex items-center justify-between rounded-lg border border-gray-100 px-3 py-2 text-sm">
      <span className={disabled ? 'text-gray-400' : ''}>{name} · {pointsCost} {label}</span>
      <div className="text-right">
        <button
          type="button"
          onClick={onRedeem}
          disabled={disabled || isPending}
          className="rounded-md bg-pink-600 px-3 py-1 text-white disabled:opacity-40"
        >
          {isPending ? 'Canjeando…' : 'Canjear'}
        </button>
        {error && <p role="alert" className="mt-1 text-xs text-destructive">{error}</p>}
      </div>
    </li>
  )
}
