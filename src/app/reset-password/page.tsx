'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { updatePassword } from '@/lib/auth/actions'
import { Lock, Sparkles } from 'lucide-react'

export default function ResetPasswordPage() {
  const router = useRouter()
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (success) {
      const timeout = setTimeout(() => router.push('/dashboard'), 2000)
      return () => clearTimeout(timeout)
    }
  }, [success, router])

  async function handleSubmit(formData: FormData) {
    setError('')
    setLoading(true)
    const result = await updatePassword(formData)
    setLoading(false)

    if (result.error) {
      setError(result.error)
      return
    }
    setSuccess(true)
  }

  return (
    <main className="studio-shell flex items-center justify-center px-4 py-12">
      <Card className="studio-card w-full max-w-md border-border/40 px-4 py-6 sm:px-8">
        <CardHeader className="px-0 text-left">
          <div className="mb-2 flex size-11 items-center justify-center rounded-xl bg-secondary text-primary">
            <Sparkles className="size-5" />
          </div>
          <CardTitle className="text-4xl font-semibold tracking-normal text-primary">Nueva contraseña</CardTitle>
          <CardDescription className="text-base text-muted-foreground">
            Crea una nueva contraseña para tu cuenta.
          </CardDescription>
        </CardHeader>
        <CardContent className="px-0">
          {success ? (
            <div className="space-y-6">
              <div className="rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-800">
                Contraseña actualizada. Redirigiendo al dashboard...
              </div>
            </div>
          ) : (
            <form action={handleSubmit} className="space-y-6">
              {error && (
                <div className="rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">
                  {error}
                </div>
              )}
              <div className="space-y-2">
                <Label className="studio-eyebrow" htmlFor="password">Contraseña nueva</Label>
                <div className="relative">
                  <Lock className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-muted-foreground" />
                  <Input className="studio-input pl-12" id="password" name="password" type="password" placeholder="Mínimo 6 caracteres" required minLength={6} />
                </div>
              </div>
              <Button type="submit" className="h-14 w-full rounded-lg text-lg font-semibold" disabled={loading}>
                {loading ? 'Guardando...' : 'Actualizar contraseña'}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </main>
  )
}
