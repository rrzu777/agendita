'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'

interface Plan {
  id: string
  name: string
}

interface AdminChangePlanDialogProps {
  businessId: string
  plans: Plan[]
  currentStatus: string
  onClose: () => void
  onSuccess: () => void
  onError: (msg: string) => void
}

export function AdminChangePlanDialog({ businessId, plans, onClose, onSuccess, onError }: AdminChangePlanDialogProps) {
  const [loading, setLoading] = useState(false)
  const [selectedPlanId, setSelectedPlanId] = useState('')

  async function handleChange() {
    if (!selectedPlanId) return
    setLoading(true)
    try {
      const { adminChangePlan } = await import('@/server/actions/admin')
      await adminChangePlan(businessId, selectedPlanId)
      onSuccess()
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Error al cambiar plan')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cambiar plan</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            {plans.map((plan) => (
              <label
                key={plan.id}
                className={`flex items-center gap-3 rounded-lg border p-3 cursor-pointer ${
                  selectedPlanId === plan.id ? 'border-primary bg-primary/5' : 'border-border'
                }`}
              >
                <input
                  type="radio"
                  name="plan"
                  value={plan.id}
                  checked={selectedPlanId === plan.id}
                  onChange={() => setSelectedPlanId(plan.id)}
                  className="accent-primary"
                />
                <span className="text-sm font-medium text-primary">{plan.name}</span>
              </label>
            ))}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={onClose} disabled={loading}>
              Cancelar
            </Button>
            <Button className="flex-1" onClick={handleChange} disabled={loading || !selectedPlanId}>
              {loading ? 'Guardando...' : 'Cambiar plan'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
