'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { FormField } from '@/components/ui/form-field'

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
  const confirmationTriggerRef = useRef<HTMLButtonElement | null>(null)
  const [confirmation, setConfirmation] = useState<{
    title: string
    description: string
    actionLabel: string
    tone?: 'default' | 'destructive'
    run: () => Promise<void>
  } | null>(null)

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
        <div
          role={message.type === 'error' ? 'alert' : 'status'}
          className={cn(
            'rounded-lg border p-3 text-sm font-semibold',
            message.type === 'success'
              ? 'border-success/20 bg-success/5 text-success'
              : 'border-destructive/20 bg-destructive/10 text-destructive',
          )}
        >
          {message.text}
        </div>
      )}

      <div className="space-y-2">
        <p className="text-sm font-semibold text-muted-foreground">Pagos de suscripción</p>
        <div className="space-y-2">
          <FormField id="admin-payment-amount" label="Monto (CLP)" required>
            {(a11y) => <Input {...a11y} id="admin-payment-amount" type="number" value={amount} onChange={(e) => setAmount(e.target.value)} className="min-h-11" min="1" />}
          </FormField>
          <FormField id="admin-payment-notes" label="Notas" optional>
            {(a11y) => <Input {...a11y} id="admin-payment-notes" value={notes} onChange={(e) => setNotes(e.target.value)} className="min-h-11" />}
          </FormField>
          <Button
            className="min-h-11 w-full"
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
          <FormField id="admin-suspension-reason" label="Razón de suspensión" optional>
            {(a11y) => <Input {...a11y} id="admin-suspension-reason" value={suspendReason} onChange={(e) => setSuspendReason(e.target.value)} className="min-h-11" />}
          </FormField>
        )}
        <Button
          variant={isSuspended ? 'default' : 'destructive'}
          className="min-h-11 w-full"
          onClick={(event) => {
            const run = () => handleAction(
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
            if (isSuspended) return run()
            confirmationTriggerRef.current = event.currentTarget
            setConfirmation({
              title: `Suspender ${businessName}`,
              description: 'El negocio perderá acceso operativo hasta que una persona administradora lo reactive.',
              actionLabel: 'Suspender negocio',
              tone: 'destructive',
              run,
            })
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
            className="min-h-11 flex-1"
            onClick={(event) => {
              confirmationTriggerRef.current = event.currentTarget
              setConfirmation({
                title: `Marcar pago pendiente para ${businessName}`,
                description: 'La cuenta quedará señalada para seguimiento de pago.',
                actionLabel: 'Marcar pendiente',
                run: () => handleAction(async () => {
                  const { adminMarkPastDue } = await import('@/server/actions/admin')
                  return adminMarkPastDue(businessId)
                },
                'pastdue',
                ),
              })
            }}
            disabled={loading !== null || isCancelled || isPastDue}
          >
            {loading === 'pastdue' ? '...' : 'Marcar pendiente'}
          </Button>
          <Button
            variant="destructive"
            size="sm"
            className="min-h-11 flex-1"
            onClick={(event) => {
              confirmationTriggerRef.current = event.currentTarget
              setConfirmation({
                title: `Cancelar renovación de ${businessName}`,
                description: 'La renovación se cancelará al cierre del período vigente; esta acción no realiza un cobro.',
                actionLabel: 'Cancelar renovación',
                tone: 'destructive',
                run: () => handleAction(async () => {
                  const { adminCancelSubscription } = await import('@/server/actions/admin')
                  return adminCancelSubscription(businessId)
                },
                'cancel',
                ),
              })
            }}
            disabled={loading !== null || isCancelled}
          >
            {loading === 'cancel' ? '...' : 'Cancelar'}
          </Button>
        </div>
      </div>

      <Dialog open={confirmation !== null} onOpenChange={(open) => { if (!open && loading === null) setConfirmation(null) }}>
        <DialogContent
          showCloseButton={false}
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            confirmationTriggerRef.current?.focus()
          }}
        >
          <DialogHeader>
            <DialogTitle>{confirmation?.title}</DialogTitle>
            <DialogDescription>{confirmation?.description}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild><Button variant="outline" disabled={loading !== null}>Volver</Button></DialogClose>
            <Button
              variant={confirmation?.tone === 'destructive' ? 'destructive' : 'default'}
              disabled={loading !== null || !confirmation}
              onClick={() => confirmation?.run().finally(() => setConfirmation(null))}
            >
              {loading !== null ? 'Procesando…' : confirmation?.actionLabel}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  )
}
