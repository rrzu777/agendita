'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
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
  const isCancelled = currentStatus === 'cancelled'
  const isPastDue = currentStatus === 'past_due'

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
            min="1"
          />
          <Input
            placeholder="Notas (opcional)"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="h-10"
          />
          <Button
            className="w-full h-10"
            onClick={() => {
              const parsed = parseInt(amount, 10)
              if (isNaN(parsed) || parsed <= 0) {
                setMessage({ type: 'error', text: 'El monto debe ser un número positivo' })
                return
              }
              return handleAction(
                async () => {
                  const { adminRecordSubscriptionPayment } = await import('@/server/actions/admin')
                  return adminRecordSubscriptionPayment(businessId, parsed, notes || undefined)
                },
                'payment'
              )
            }}
            disabled={loading !== null || !amount}
          >
            {loading === 'payment' ? 'Registrando...' : 'Registrar pago manual'}
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
          onClick={() => {
            if (!isSuspended && !window.confirm(`¿Suspender ${businessName}?`)) return
            return handleAction(
              isSuspended
              ? async () => {
                  const { adminActivateBusiness } = await import('@/server/actions/admin')
                  return adminActivateBusiness(businessId)
                }
              : async () => {
                  const { adminSuspendBusiness } = await import('@/server/actions/admin')
                  return adminSuspendBusiness(businessId, suspendReason || undefined)
                },
              'suspend'
            )
          }}
          disabled={loading !== null}
        >
          {loading === 'suspend'
            ? 'Procesando...'
            : isSuspended
              ? 'Reactivar negocio'
              : 'Suspender negocio'}
        </Button>
      </div>

      <div className="space-y-2">
        <p className="text-sm font-semibold text-muted-foreground">Estado de pago</p>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            className="flex-1 h-9"
            onClick={() => {
              if (!window.confirm(`¿Marcar la suscripción de ${businessName} como pendiente?`)) return
              return handleAction(async () => {
                const { adminMarkPastDue } = await import('@/server/actions/admin')
                return adminMarkPastDue(businessId)
              },
              'pastdue'
              )
            }}
            disabled={loading !== null || isCancelled || isPastDue}
          >
            {loading === 'pastdue' ? '...' : 'Marcar pendiente'}
          </Button>
          <Button
            variant="destructive"
            size="sm"
            className="flex-1 h-9"
            onClick={() => {
              if (!window.confirm(`¿Cancelar la renovación de ${businessName} al cierre del periodo?`)) return
              return handleAction(async () => {
                const { adminCancelSubscription } = await import('@/server/actions/admin')
                return adminCancelSubscription(businessId)
              },
              'cancel'
              )
            }}
            disabled={loading !== null || isCancelled}
          >
            {loading === 'cancel' ? '...' : 'Cancelar'}
          </Button>
        </div>
      </div>

    </div>
  )
}
