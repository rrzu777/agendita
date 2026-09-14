'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { FormField } from '@/components/ui/form-field'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { updatePassword } from '@/lib/auth/actions'
import { Eye, EyeOff, Loader2, Lock } from 'lucide-react'
import { AuthShell } from '@/components/platform/platform-shell'

export default function ResetPasswordPage() {
  const router = useRouter()
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const [loading, setLoading] = useState(false)
  const [showPassword, setShowPassword] = useState(false)

  useEffect(() => {
    if (success) {
      const timeout = setTimeout(() => router.push('/dashboard'), 2000)
      return () => clearTimeout(timeout)
    }
  }, [success, router])

  async function handleSubmit(formData: FormData) {
    setError('')
    setLoading(true)
    try {
      const result = await updatePassword(formData)
      if (result.error) {
        setError(result.error)
        return
      }
      setSuccess(true)
    } catch {
      setError('No pudimos actualizar la contraseña. Revisa tu conexión e intenta nuevamente.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthShell audience="owner"><main className="mx-auto w-full max-w-md">
      <Card className="w-full border-border px-4 py-6 shadow-sm sm:px-8">
        <CardHeader className="px-0 text-left">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Acceso para negocios</p>
          <CardTitle className="font-heading text-4xl font-semibold tracking-tight text-primary"><h1>Nueva contraseña</h1></CardTitle>
          <CardDescription className="text-base text-muted-foreground">
            Crea una nueva contraseña para tu cuenta.
          </CardDescription>
        </CardHeader>
        <CardContent className="px-0">
          {success ? (
            <div className="space-y-6">
              <div role="status" className="rounded-lg border border-success/30 bg-success/10 p-4 text-sm text-success">
                Contraseña actualizada. Redirigiendo al dashboard...
              </div>
            </div>
          ) : (
            <form action={handleSubmit} noValidate className="space-y-6">
              {error && (
                <div role="alert" className="rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">
                  {error}
                </div>
              )}
              <FormField id="password" label="Contraseña nueva" required help="Mínimo 6 caracteres">
                {(a11y) => <div className="relative"><Lock className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-muted-foreground" /><Input className="px-12" id="password" name="password" type={showPassword ? 'text' : 'password'} required minLength={6} autoComplete="new-password" density="touch" {...a11y} /><button type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'} aria-pressed={showPassword} className="absolute right-1 top-1/2 flex size-11 -translate-y-1/2 items-center justify-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-primary">{showPassword ? <EyeOff className="size-5" /> : <Eye className="size-5" />}</button></div>}
              </FormField>
              <Button type="submit" size="touch" className="w-full rounded-full font-semibold" disabled={loading}>
                {loading && <Loader2 className="mr-2 size-4 animate-spin" />}
                {loading ? 'Guardando...' : 'Actualizar contraseña'}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </main></AuthShell>
  )
}
