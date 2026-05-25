'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { signUp } from '@/lib/auth/actions'
import { CheckCircle2, Lock, Mail, Sparkles, User } from 'lucide-react'

export default function RegisterPage() {
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const [loading, setLoading] = useState(false)
  const [acceptedTerms, setAcceptedTerms] = useState(false)

  async function handleSubmit(formData: FormData) {
    setError('')
    setSuccess(false)

    if (!acceptedTerms) {
      setError('Debes aceptar los términos y condiciones y la política de privacidad')
      return
    }

    setLoading(true)

    try {
      await signUp(formData)
      setSuccess(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al crear cuenta')
    } finally {
      setLoading(false)
    }
  }

  if (success) {
    return (
      <main className="studio-shell flex items-center justify-center px-4 py-12">
        <Card className="studio-card w-full max-w-md px-4 py-6 sm:px-8">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-xl bg-secondary text-primary">
              <CheckCircle2 className="size-6" />
            </div>
            <CardTitle className="text-3xl text-primary">Verifica tu email</CardTitle>
            <CardDescription>
              Te enviamos un email de confirmación. Haz clic en el enlace para activar tu cuenta.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-center text-sm text-muted-foreground">
              ¿Ya confirmaste?{' '}
              <Link href="/login" className="font-semibold text-primary hover:underline">
                Inicia sesión
              </Link>
            </p>
          </CardContent>
        </Card>
      </main>
    )
  }

  return (
    <main className="studio-shell flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-[440px]">
        <div className="mb-10 text-center">
          <h1 className="text-6xl font-semibold tracking-normal text-primary sm:text-7xl">Agendita</h1>
          <p className="mt-3 text-xl text-muted-foreground">Tu estudio, ordenado desde el primer día</p>
        </div>
      <Card className="studio-card w-full px-4 py-6 sm:px-8">
        <CardHeader className="px-0 text-left">
          <div className="mb-2 flex size-11 items-center justify-center rounded-xl bg-secondary text-primary">
            <Sparkles className="size-5" />
          </div>
          <CardTitle className="text-4xl font-semibold tracking-normal text-primary">Crea tu cuenta</CardTitle>
          <CardDescription className="text-base text-muted-foreground">Empieza a recibir reservas online</CardDescription>
        </CardHeader>
        <CardContent className="px-0">
          <form action={handleSubmit} className="space-y-6">
            {error && (
              <div className="rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">
                {error}
              </div>
            )}
            <div className="space-y-2">
              <Label className="studio-eyebrow" htmlFor="name">Nombre</Label>
              <div className="relative">
                <User className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-muted-foreground" />
                <Input className="studio-input pl-12" id="name" name="name" placeholder="Tu nombre" required />
              </div>
            </div>
            <div className="space-y-2">
              <Label className="studio-eyebrow" htmlFor="email">Email</Label>
              <div className="relative">
                <Mail className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-muted-foreground" />
                <Input className="studio-input pl-12" id="email" name="email" type="email" placeholder="hola@tunegocio.cl" required />
              </div>
            </div>
            <div className="space-y-2">
              <Label className="studio-eyebrow" htmlFor="password">Contraseña</Label>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-muted-foreground" />
                <Input className="studio-input pl-12" id="password" name="password" type="password" placeholder="Mínimo 6 caracteres" required minLength={6} />
              </div>
            </div>
            <div className="flex items-start gap-3">
              <input
                type="checkbox"
                id="accept-terms"
                checked={acceptedTerms}
                onChange={(e) => setAcceptedTerms(e.target.checked)}
                className="mt-0.5 size-4 rounded border-border accent-primary"
              />
              <input type="hidden" name="acceptedTerms" value={acceptedTerms ? 'true' : 'false'} />
              <label htmlFor="accept-terms" className="text-sm text-muted-foreground">
                Acepto los{' '}
                <a href="/terms" target="_blank" className="font-semibold text-primary underline">
                  Términos y Condiciones
                </a>{' '}
                y la{' '}
                <a href="/privacy" target="_blank" className="font-semibold text-primary underline">
                  Política de Privacidad
                </a>
              </label>
            </div>
            <Button type="submit" className="h-14 w-full rounded-lg text-lg font-semibold shadow-[0_14px_32px_rgba(51,41,32,0.18)]" disabled={loading || !acceptedTerms}>
              {loading ? 'Creando cuenta...' : 'Crear cuenta'}
            </Button>
          </form>
          <p className="mt-8 text-center text-base text-muted-foreground">
            ¿Ya tienes cuenta?{' '}
            <Link href="/login" className="font-semibold text-primary hover:underline">
              Inicia sesión
            </Link>
          </p>
        </CardContent>
      </Card>
      </div>
    </main>
  )
}
