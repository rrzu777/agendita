'use client'

import { useState, type FormEvent } from 'react'
import Link from 'next/link'
import { unstable_rethrow } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { FormField } from '@/components/ui/form-field'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { signIn } from '@/lib/auth/actions'
import { Eye, Loader2, Lock, Mail, Sparkles } from 'lucide-react'

export default function LoginPage() {
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

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
      setError(err instanceof Error ? err.message : 'Error al iniciar sesión')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="studio-shell flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-[440px]">
        <div className="mb-10 text-center">
          <h1 className="font-heading text-6xl font-semibold tracking-tight text-primary sm:text-7xl">Agendita</h1>
          <p className="mt-3 text-xl text-muted-foreground">Agenda online para estudios boutique</p>
        </div>

        <Card className="studio-card w-full border-border/40 px-4 py-6 sm:px-8">
        <CardHeader className="px-0 text-left">
          <div className="mb-2 flex size-11 items-center justify-center rounded-xl bg-secondary text-primary">
            <Sparkles className="size-5" />
          </div>
          <CardTitle className="font-heading text-4xl font-semibold tracking-tight text-primary">Hola de nuevo</CardTitle>
          <CardDescription className="text-base text-muted-foreground">
            Ingresa tus datos para gestionar tus citas.
          </CardDescription>
        </CardHeader>
        <CardContent className="px-0">
          <form onSubmit={handleSubmit} className="space-y-6">
            {error && (
              <div role="alert" className="rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">
                {error}
              </div>
            )}
            <FormField id="email" label="Email" required>
              {(a11y) => <div className="relative"><Mail className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-muted-foreground" /><Input className="pl-12" id="email" name="email" type="email" placeholder="ejemplo@correo.com" required density="touch" {...a11y} /></div>}
            </FormField>
            <div className="relative">
              <Link href="/forgot-password" className="absolute right-0 top-0 z-10 text-sm font-semibold text-primary hover:underline">Olvidé mi contraseña</Link>
              <FormField id="password" label="Contraseña" required>
                {(a11y) => <div className="relative"><Lock className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-muted-foreground" /><Input className="px-12" id="password" name="password" type="password" placeholder="••••••••" required density="touch" {...a11y} /><Eye className="pointer-events-none absolute right-4 top-1/2 size-5 -translate-y-1/2 text-muted-foreground" /></div>}
              </FormField>
            </div>
            <Button
              type="submit"
              size="touch"
              className="w-full rounded-full font-semibold shadow-[0_14px_32px_rgba(51,41,32,0.18)]"
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
            <Link href="/register" className="font-semibold text-primary hover:underline">
              Crear cuenta
            </Link>
          </p>
        </CardContent>
      </Card>
      </div>
    </main>
  )
}
