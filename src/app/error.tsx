'use client'

import { Button } from '@/components/ui/button'
import { AlertTriangle } from 'lucide-react'
import { MarketingShell } from '@/components/platform/platform-shell'

export default function Error({
  error,
  retry,
}: {
  error: Error & { digest?: string }
  retry: () => void
}) {
  return (
    <MarketingShell><main className="flex min-h-[calc(100vh-4rem)] flex-col items-center justify-center px-4 py-20">
      <AlertTriangle className="mb-4 size-12 text-destructive" />
      <h1 className="mb-2 text-2xl font-semibold text-primary">Algo salió mal</h1>
      <p className="mb-6 max-w-sm text-center text-muted-foreground">
        Ocurrió un error inesperado. Por favor intenta nuevamente.
      </p>
      {process.env.NODE_ENV === 'development' && error?.digest && (
        <code className="mb-4 max-w-full truncate rounded-lg border border-border bg-muted px-3 py-2 font-mono text-xs text-muted-foreground">
          {error.digest}
        </code>
      )}
      <Button onClick={retry} size="touch" className="rounded-lg font-semibold">
        Reintentar
      </Button>
    </main></MarketingShell>
  )
}
