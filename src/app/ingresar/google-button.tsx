'use client'

import { useFormStatus } from 'react-dom'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'

/** Botón de submit con estado pending: entre el clic y el redirect a Google hay
 *  1-2s de round-trip al server action — sin esto el botón parece muerto. */
export function GoogleButton() {
  const { pending } = useFormStatus()
  return (
    <Button
      type="submit"
      className="h-14 w-full rounded-full text-lg font-semibold"
      disabled={pending}
      data-auth-loading={pending ? 'true' : undefined}
      aria-busy={pending}
    >
      {pending && <Loader2 className="mr-2 size-4 animate-spin" />}
      {pending ? 'Conectando con Google…' : 'Continuar con Google'}
    </Button>
  )
}
