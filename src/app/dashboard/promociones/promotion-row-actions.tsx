'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Power, PowerOff, Receipt } from 'lucide-react'
import { TableActions } from '@/components/ui/table-actions'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { PromotionForm, type EditPromo } from './promotion-form'
import { RedemptionsButton } from './redemptions-button'
import { setPromotionActive } from '@/server/actions/promotions'

interface ServiceOption {
  id: string
  name: string
}

export function PromotionRowActions({
  promo,
  services,
  currency,
}: {
  promo: EditPromo
  services: ServiceOption[]
  currency: string
}) {
  const router = useRouter()
  const [redemptionsOpen, setRedemptionsOpen] = useState(false)
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function handleToggle() {
    setError(null)
    startTransition(async () => {
      try {
        const res = await setPromotionActive(promo.id, !promo.isActive)
        if (!res.ok) { setError(res.error); return }
        router.refresh()
      } catch {
        setError('No se pudo actualizar')
      }
    })
  }

  return (
    <>
      <div className="flex flex-col items-end gap-1">
        <TableActions
          primary={
            <PromotionForm mode="edit" services={services} currency={currency} promo={promo} />
          }
        >
          <DropdownMenuItem onSelect={(e) => { e.preventDefault(); setRedemptionsOpen(true) }}>
            <Receipt className="size-4" /> Ver canjes
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={(e) => { e.preventDefault(); handleToggle() }} disabled={isPending}>
            {promo.isActive ? <PowerOff className="size-4" /> : <Power className="size-4" />}
            {promo.isActive ? 'Desactivar' : 'Activar'}
          </DropdownMenuItem>
        </TableActions>
        {error && <span className="text-xs text-destructive">{error}</span>}
      </div>

      <RedemptionsButton
        promotionId={promo.id}
        promotionName={promo.name}
        currency={currency}
        hideTrigger
        open={redemptionsOpen}
        onOpenChange={setRedemptionsOpen}
      />
    </>
  )
}
