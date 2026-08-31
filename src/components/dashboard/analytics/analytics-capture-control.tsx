'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { setAnalyticsCollectionEnabled } from '@/server/actions/analytics'
import type { OwnerAnalyticsReport } from '@/server/analytics/reports'
import { Button } from '@/components/ui/button'

export function AnalyticsCaptureControl({ capture }: { capture: OwnerAnalyticsReport['capture'] }) {
  const [message, setMessage] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const router = useRouter()
  function change(enabled: boolean) {
    startTransition(async () => {
      try {
        const result = await setAnalyticsCollectionEnabled(enabled)
        setMessage(result.ok ? enabled ? 'Período de captura abierto.' : 'Período de captura cerrado.' : result.error)
        if (result.ok) router.refresh()
      } catch { setMessage('No se pudo cambiar la captura. Intenta nuevamente.') }
    })
  }
  return <section aria-label="Control de captura" className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
    <div className="min-w-0 space-y-1"><h2 className="text-sm font-semibold text-primary">Captura: {capture.enabled ? 'habilitada' : capture.collectionOpen ? 'apagada por configuración, período abierto' : 'período cerrado'}</h2><p className="max-w-2xl text-xs text-muted-foreground">Abrir exige autorización operativa previa y todos los requisitos de configuración, privacidad, piloto, Redis y presupuesto. Cerrar permanece disponible sin Redis. No modifica la configuración global.</p>{message && <p role="status" className="text-sm">{message}</p>}</div>
    <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => change(!capture.collectionOpen)}>{capture.collectionOpen ? 'Cerrar captura' : 'Abrir captura'}</Button>
  </section>
}
