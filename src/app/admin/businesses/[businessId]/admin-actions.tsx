'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { AdminChangePlanDialog } from './admin-change-plan-dialog'
import { cn } from '@/lib/utils'

interface AdminActionsProps {
  businessId: string
  businessName: string
  currentStatus: string
  plans: Array<{ id: string; name: string }>
}

export function AdminActions({ businessId, businessName, currentStatus, plans }: AdminActionsProps) {
  const router = useRouter()
  const [loading, setLoading] = useState<string | null>(null)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [amount, setAmount] = useState('')
  const [notes, setNotes] = useState('')
  const [trialDays, setTrialDays] = useState('30')
  const [suspendReason, setSuspendReason] = useState('')
  const [showChangePlan, setShowChangePlan] = useState(false)

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
        <p className="text-sm font-semibold text-muted-foreground">Extender trial</p>
        <div className="flex gap-2">
          <Input
            type="number"
            placeholder="Días"
            value={trialDays}
            onChange={(e) => setTrialDays(e.target.value)}
            className="h-10 w-24"
            min="1"
            max="365"
          />
          <Button
            variant="outline"
            className="h-10 flex-1"
            onClick={() => {
              const parsed = parseInt(trialDays, 10)
              if (isNaN(parsed) || parsed < 1 || parsed > 365) {
                setMessage({ type: 'error', text: 'Los días deben ser entre 1 y 365' })
                return
              }
              return handleAction(
                async () => {
                  const { adminExtendTrial } = await import('@/server/actions/admin')
                  return adminExtendTrial(businessId, parsed)
                },
                'trial'
              )
            }}
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
              ? async () => {
                  const { adminActivateBusiness } = await import('@/server/actions/admin')
                  return adminActivateBusiness(businessId)
                }
              : async () => {
                  const { adminSuspendBusiness } = await import('@/server/actions/admin')
                  return adminSuspendBusiness(businessId, suspendReason || undefined)
                },
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

      <div className="space-y-2">
        <p className="text-sm font-semibold text-muted-foreground">Plan</p>
        <Button
          variant="outline"
          className="w-full h-10"
          onClick={() => setShowChangePlan(true)}
          disabled={loading !== null || isCancelled}
        >
          Cambiar plan
        </Button>
      </div>

      <div className="space-y-2">
        <p className="text-sm font-semibold text-muted-foreground">Estado de pago</p>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            className="flex-1 h-9"
            onClick={() => handleAction(
              async () => {
                const { adminMarkPastDue } = await import('@/server/actions/admin')
                return adminMarkPastDue(businessId)
              },
              'pastdue'
            )}
            disabled={loading !== null || isCancelled || isPastDue}
          >
            {loading === 'pastdue' ? '...' : 'Marcar pendiente'}
          </Button>
          <Button
            variant="destructive"
            size="sm"
            className="flex-1 h-9"
            onClick={() => handleAction(
              async () => {
                const { adminCancelSubscription } = await import('@/server/actions/admin')
                return adminCancelSubscription(businessId)
              },
              'cancel'
            )}
            disabled={loading !== null || isCancelled}
          >
            {loading === 'cancel' ? '...' : 'Cancelar'}
          </Button>
        </div>
      </div>

      {showChangePlan && (
        <AdminChangePlanDialog
          businessId={businessId}
          plans={plans}
          currentStatus={currentStatus}
          onClose={() => setShowChangePlan(false)}
          onSuccess={() => {
            setShowChangePlan(false)
            setMessage({ type: 'success', text: 'Plan actualizado' })
            router.refresh()
          }}
          onError={(msg) => setMessage({ type: 'error', text: msg })}
        />
      )}
    </div>
  )
}
