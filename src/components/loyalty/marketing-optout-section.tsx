'use client'

import { useState, useTransition } from 'react'

/** Baja/re-alta de promociones al pie de la tarjeta y de /mi. `action` viene
 *  bindeada del server component (token o customerId van server-side, nunca
 *  en el body del form — mismo criterio que redeemAction en /tarjeta). */
export function MarketingOptOutSection({
  businessName,
  optedOut,
  action,
}: {
  businessName: string
  optedOut: boolean
  action: (optedOut: boolean) => Promise<void>
}) {
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [currentOptedOut, setCurrentOptedOut] = useState(optedOut)
  const [saved, setSaved] = useState(false)

  function submit(next: boolean) {
    setError(null)
    setSaved(false)
    startTransition(async () => {
      try {
        await action(next)
        setCurrentOptedOut(next)
        setSaved(true)
      } catch {
        setError('No se pudo guardar')
      }
    })
  }

  return (
    <div className="mt-5 text-sm text-muted-foreground">
      {currentOptedOut ? (
        <>
          <p>No recibirás promociones de {businessName}.</p>
          <button
            type="button"
            className="mt-2 min-h-11 rounded-lg px-2 font-semibold text-primary hover:bg-secondary disabled:opacity-50"
            onClick={() => submit(false)}
            disabled={isPending}
            aria-busy={isPending}
          >
            Volver a recibirlas
          </button>
        </>
      ) : (
        <button
          type="button"
          className="min-h-11 rounded-lg px-2 text-left hover:bg-secondary hover:text-primary disabled:opacity-50"
          onClick={() => submit(true)}
          disabled={isPending}
          aria-busy={isPending}
        >
          No quiero recibir promociones de {businessName}
        </button>
      )}
      {saved && <p role="status" className="mt-2 text-xs text-success">Preferencia guardada.</p>}
      {error && <p role="alert" className="mt-1 text-xs text-destructive">{error}</p>}
    </div>
  )
}
