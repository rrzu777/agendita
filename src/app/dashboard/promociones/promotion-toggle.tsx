'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Power, PowerOff } from 'lucide-react'
import { setPromotionActive } from '@/server/actions/promotions'

export function PromotionToggle({ id, isActive }: { id: string; isActive: boolean }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function handleToggle() {
    setError(null)
    startTransition(async () => {
      try {
        await setPromotionActive(id, !isActive)
        router.refresh()
      } catch (e) {
        setError(e instanceof Error ? e.message : 'No se pudo actualizar')
      }
    })
  }

  return (
    <div className="flex flex-col items-end">
      <Button type="button" size="sm" variant="outline" disabled={isPending} onClick={handleToggle}>
        {isActive ? <PowerOff className="mr-1 size-4" /> : <Power className="mr-1 size-4" />}
        {isActive ? 'Desactivar' : 'Activar'}
      </Button>
      {error && <span className="mt-1 text-xs text-destructive">{error}</span>}
    </div>
  )
}
