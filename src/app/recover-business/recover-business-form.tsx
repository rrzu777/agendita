'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { recoverBusiness } from '@/server/actions/recover-business'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

interface RecoverBusinessFormProps {
  email: string
  name: string | null
}

export function RecoverBusinessForm({ email, name }: RecoverBusinessFormProps) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function handleRecover() {
    setError(null)

    startTransition(async () => {
      const result = await recoverBusiness()

      if (!result.success) {
        setError(result.error)
        return
      }

      router.push(result.redirectTo)
      router.refresh()
    })
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>Recuperar negocio</CardTitle>
        <CardDescription>
          Parece que tu cuenta no tiene un negocio asociado. Esto puede pasar si tu cuenta se
          creó correctamente pero hubo un problema al configurar tu negocio. Podemos intentar
          reconstruirlo automáticamente.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="rounded-lg border bg-muted/40 p-3 text-sm text-muted-foreground">
          <p><strong>Cuenta:</strong> {email}</p>
          {name && <p><strong>Nombre:</strong> {name}</p>}
        </div>

        <p className="text-sm text-muted-foreground">
          Se creará tu negocio con una suscripción beta gratuita y horarios iniciales.
        </p>

        {error && (
          <div className="rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </div>
        )}

        <Button
          type="button"
          className="w-full"
          onClick={handleRecover}
          disabled={isPending}
        >
          {isPending ? 'Recuperando...' : 'Recuperar mi negocio'}
        </Button>
      </CardContent>
    </Card>
  )
}
