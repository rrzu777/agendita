'use client'

import { useFormStatus } from 'react-dom'
import { Button } from '@/components/ui/button'
import {
  requestSubscriptionCancellation,
  startSubscriptionCheckout,
} from '@/server/actions/subscription-billing'

function SubmitButton({
  children,
  pendingLabel,
  variant = 'default',
}: {
  children: React.ReactNode
  pendingLabel: string
  variant?: 'default' | 'outline'
}) {
  const { pending } = useFormStatus()

  return (
    <Button type="submit" variant={variant} className="w-full" disabled={pending}>
      {pending ? pendingLabel : children}
    </Button>
  )
}

export function SubscriptionActions({
  canStartCheckout,
  canCancel,
}: {
  canStartCheckout: boolean
  canCancel: boolean
}) {
  return (
    <>
      {canStartCheckout && (
        <form action={startSubscriptionCheckout}>
          <SubmitButton pendingLabel="Abriendo Mercado Pago…">
            Activar mensualidad automática
          </SubmitButton>
        </form>
      )}
      {canCancel && (
        <form action={requestSubscriptionCancellation}>
          <SubmitButton pendingLabel="Cancelando renovación…" variant="outline">
            Cancelar al final del período
          </SubmitButton>
        </form>
      )}
    </>
  )
}
