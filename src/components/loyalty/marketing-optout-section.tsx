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

  function submit(next: boolean) {
    setError(null)
    startTransition(async () => {
      try {
        await action(next)
      } catch {
        setError('No se pudo guardar')
      }
    })
  }

  return (
    <div className="mt-8 text-center text-sm text-muted-foreground">
      {optedOut ? (
        <>
          <p>No recibirás promociones de {businessName}.</p>
          <button
            type="button"
            className="mt-1 font-semibold text-pink-700 hover:underline disabled:opacity-50"
            onClick={() => submit(false)}
            disabled={isPending}
          >
            Volver a recibirlas
          </button>
        </>
      ) : (
        <button
          type="button"
          className="hover:underline disabled:opacity-50"
          onClick={() => submit(true)}
          disabled={isPending}
        >
          No quiero recibir promociones de {businessName}
        </button>
      )}
      {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
    </div>
  )
}
