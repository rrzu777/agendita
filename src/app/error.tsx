'use client'

import { Button } from '@/components/ui/button'
import { AlertTriangle } from 'lucide-react'

export default function Error({
  error,
  reset,
}: {
  error: string & { digest?: string }
  reset: () => void
}) {
  return (
    <div className="studio-shell flex flex-col items-center justify-center py-20">
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
      <Button onClick={reset} className="rounded-lg font-semibold">
        Reintentar
      </Button>
    </div>
  )
}