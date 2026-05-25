'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import { adminExtendTrial, adminSuspendBusiness, adminActivateBusiness, adminRecordSubscriptionPayment } from '@/server/actions/admin'
import { cn } from '@/lib/utils'

interface AdminActionsProps {
  businessId: string
  businessName: string
  currentStatus: string
}

export function AdminActions({ businessId, businessName, currentStatus }: AdminActionsProps) {
  const router = useRouter()
  const [loading, setLoading] = useState<string | null>(null)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [amount, setAmount] = useState('')
  const [notes, setNotes] = useState('')
  const [trialDays, setTrialDays] = useState('30')
  const [suspendReason, setSuspendReason] = useState('')

  async function handleAction(action: () => Promise<unknown>, actionName: string) {
    setLoading(actionName)
    setMessage(null)
    try {
      await action()
      setMessage({ type: 'success', text: 'Acción completada exitosamente' })
      router.refresh()
    } catch (error) {
      setMessage({
        type: 'error',
        text: error instanceof Error ? error.message : 'Error inesperado',
      })
    } finally {
      setLoading(null)
    }
  }

  const isSuspended = currentStatus === 'suspended'

  return (
    <div className="space-y-4">
      {message && (
        <div className={cn(
          'rounded-lg p-3 text-sm font-semibold',
          message.type === 'success' ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'
        )}>
          {message.text}
        </div>
      )}

      <div className="space-y-2">
        <p className="text-sm font-semibold text-muted-foreground">Pagos de suscripción</p>
        <div className="space-y-2">
          <Input
            type="number"
            placeholder="Monto en CLP"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="h-10"
          />
          <Input
            placeholder="Notas (opcional)"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="h-10"
          />
          <Button
            className="w-full h-10"
            onClick={() => handleAction(
              () => adminRecordSubscriptionPayment(businessId, parseInt(amount), notes || undefined),
              'payment'
            )}
            disabled={!amount || loading !== null}
          >
            {loading === 'payment' ? 'Registrando...' : 'Registrar pago manual'}
          </Button>
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-sm font-semibold text-muted-foreground">Extender trial</p>
        <div className="flex gap-2">
          <Input
            type="number"
            placeholder="Días"
            value={trialDays}
            onChange={(e) => setTrialDays(e.target.value)}
            className="h-10 w-24"
          />
          <Button
            variant="outline"
            className="h-10 flex-1"
            onClick={() => handleAction(
              () => adminExtendTrial(businessId, parseInt(trialDays)),
              'trial'
            )}
            disabled={loading !== null}
          >
            {loading === 'trial' ? 'Extendiendo...' : `Extender ${trialDays} días`}
          </Button>
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-sm font-semibold text-muted-foreground">
          {isSuspended ? 'Reactivar negocio' : 'Suspender negocio'}
        </p>
        {!isSuspended && (
          <Input
            placeholder="Razón de suspensión (opcional)"
            value={suspendReason}
            onChange={(e) => setSuspendReason(e.target.value)}
            className="h-10"
          />
        )}
        <Button
          variant={isSuspended ? 'default' : 'destructive'}
          className="w-full h-10"
          onClick={() => handleAction(
            isSuspended
              ? () => adminActivateBusiness(businessId)
              : () => adminSuspendBusiness(businessId, suspendReason || undefined),
            'suspend'
          )}
          disabled={loading !== null}
        >
          {loading === 'suspend'
            ? 'Procesando...'
            : isSuspended
              ? 'Reactivar negocio'
              : 'Suspender negocio'}
        </Button>
      </div>
    </div>
  )
}
