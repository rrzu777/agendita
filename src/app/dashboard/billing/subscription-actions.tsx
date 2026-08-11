'use client'

import { useActionState } from 'react'
import { Button } from '@/components/ui/button'
import {
  cancelSubscriptionAction,
  startSubscriptionAction,
  type SubscriptionActionState,
} from '@/server/actions/subscriptions'

const initialState: SubscriptionActionState = { error: null }

export function SubscriptionActions({
  canStartCheckout,
  canCancel,
}: {
  canStartCheckout: boolean
  canCancel: boolean
}) {
  const [startState, startAction, startPending] = useActionState(startSubscriptionAction, initialState)
  const [cancelState, cancelAction, cancelPending] = useActionState(cancelSubscriptionAction, initialState)

  return (
    <>
      {canStartCheckout && (
        <form action={startAction} className="space-y-2">
          <Button type="submit" className="w-full" disabled={startPending}>
            {startPending ? 'Abriendo Mercado Pago…' : 'Activar mensualidad automática'}
          </Button>
          {startState.error && (
            <p role="alert" aria-live="polite" className="text-xs text-destructive">
              {startState.error}
            </p>
          )}
        </form>
      )}
      {canCancel && (
        <form action={cancelAction} className="space-y-2">
          <Button type="submit" variant="outline" className="w-full" disabled={cancelPending}>
            {cancelPending ? 'Cancelando renovación…' : 'Cancelar al final del período'}
          </Button>
          {cancelState.error && (
            <p role="alert" aria-live="polite" className="text-xs text-destructive">
              {cancelState.error}
            </p>
          )}
        </form>
      )}
    </>
  )
}
