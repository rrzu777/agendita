'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Switch } from '@/components/ui/switch'
import { setCustomerMarketingOptOut } from '@/server/actions/customers'

/** Toggle "Acepta campañas" de la ficha. checked = acepta (flag null);
 *  apagarlo = opt-out. La fecha de baja se muestra como mini-auditoría. */
export function MarketingOptOutToggle({
  customerId,
  marketingOptOutAt,
}: {
  customerId: string
  marketingOptOutAt: Date | null
}) {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleChange(accepts: boolean) {
    setPending(true)
    setError(null)
    try {
      await setCustomerMarketingOptOut(customerId, !accepts)
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar')
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="mt-4 border-t pt-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-primary">Acepta campañas</p>
          <p className="text-xs text-muted-foreground">
            Promociones por WhatsApp y email. No afecta confirmaciones ni recordatorios.
          </p>
        </div>
        <Switch
          checked={marketingOptOutAt === null}
          onCheckedChange={handleChange}
          disabled={pending}
          aria-label="Acepta campañas"
        />
      </div>
      {marketingOptOutAt && (
        <p className="mt-2 text-xs text-muted-foreground">
          Se dio de baja el {new Date(marketingOptOutAt).toLocaleDateString('es-CL')}
        </p>
      )}
      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
    </div>
  )
}
