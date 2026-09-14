'use client'

import { useState, type FormEvent } from 'react'
import Link from 'next/link'
import { unstable_rethrow } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { FormField } from '@/components/ui/form-field'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { signIn } from '@/lib/auth/actions'
import { Eye, EyeOff, Loader2, Lock, Mail } from 'lucide-react'
import { AuthShell } from '@/components/platform/platform-shell'

export default function LoginPage() {
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [showPassword, setShowPassword] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    setError('')
    setLoading(true)

    try {
      const formData = new FormData(event.currentTarget)
      const result = await signIn(formData)
      if (result?.error) {
        setError(result.error)
      }
    } catch (err) {
      unstable_rethrow(err)
      setError('No pudimos iniciar sesión. Revisa tu conexión e intenta nuevamente.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthShell audience="owner">
      <main className="mx-auto w-full max-w-[440px]">
        <Card className="w-full border-border px-4 py-6 shadow-sm sm:px-8">
        <CardHeader className="px-0 text-left">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Acceso para negocios</p>
          <CardTitle className="font-heading text-3xl font-semibold tracking-tight text-primary"><h1>Iniciar sesión</h1></CardTitle>
          <CardDescription className="text-base text-muted-foreground">
            Ingresa tus datos para gestionar tus citas.
          </CardDescription>
        </CardHeader>
        <CardContent className="px-0">
          <form onSubmit={handleSubmit} noValidate className="space-y-6">
            {error && (
              <div role="alert" className="rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">
                {error}
              </div>
            )}
            <FormField id="email" label="Email" required>
              {(a11y) => <div className="relative"><Mail className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-muted-foreground" /><Input className="pl-12" id="email" name="email" type="email" placeholder="ejemplo@correo.com" required density="touch" {...a11y} /></div>}
            </FormField>
            <div className="relative">
              <Link href="/forgot-password" className="absolute -right-2 -top-3 z-10 inline-flex min-h-11 items-center px-2 text-sm font-semibold text-primary hover:underline">Olvidé mi contraseña</Link>
              <FormField id="password" label="Contraseña" required>
                {(a11y) => <div className="relative"><Lock className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-muted-foreground" /><Input className="px-12" id="password" name="password" type={showPassword ? 'text' : 'password'} placeholder="••••••••" required autoComplete="current-password" density="touch" {...a11y} /><button type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'} aria-pressed={showPassword} className="absolute right-1 top-1/2 flex size-11 -translate-y-1/2 items-center justify-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-primary">{showPassword ? <EyeOff className="size-5" /> : <Eye className="size-5" />}</button></div>}
              </FormField>
            </div>
            <Button
              type="submit"
              size="touch"
              className="w-full rounded-full font-semibold shadow-sm"
              disabled={loading}
              data-auth-loading={loading ? 'true' : undefined}
              aria-busy={loading}
            >
              {loading && <Loader2 className="mr-2 size-4 animate-spin" />}
              {loading ? 'Iniciando sesión...' : 'Iniciar sesión'}
            </Button>
          </form>
          <div className="my-8 h-px bg-border/50" />
          <p className="text-center text-base text-muted-foreground">
            ¿No tienes cuenta?{' '}
            <Link href="/register" className="inline-flex min-h-11 items-center font-semibold text-primary hover:underline">
              Crear cuenta
            </Link>
          </p>
        </CardContent>
        </Card>
      </main>
    </AuthShell>
  )
}
