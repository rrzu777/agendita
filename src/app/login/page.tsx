'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { signIn } from '@/lib/auth/actions'
import { Eye, Lock, Mail, Sparkles } from 'lucide-react'

export default function LoginPage() {
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(formData: FormData) {
    setError('')
    setLoading(true)

    try {
      await signIn(formData)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al iniciar sesión')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="studio-shell flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-[440px]">
        <div className="mb-10 text-center">
          <h1 className="text-6xl font-semibold tracking-normal text-primary sm:text-7xl">Agendita</h1>
          <p className="mt-3 text-xl text-muted-foreground">Agenda online para estudios boutique</p>
        </div>

        <Card className="studio-card w-full border-border/40 px-4 py-6 sm:px-8">
        <CardHeader className="px-0 text-left">
          <div className="mb-2 flex size-11 items-center justify-center rounded-xl bg-secondary text-primary">
            <Sparkles className="size-5" />
          </div>
          <CardTitle className="text-4xl font-semibold tracking-normal text-primary">Bienvenida</CardTitle>
          <CardDescription className="text-base text-muted-foreground">
            Ingresa tus datos para gestionar tus citas.
          </CardDescription>
        </CardHeader>
        <CardContent className="px-0">
          <form action={handleSubmit} className="space-y-6">
            {error && (
              <div className="rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">
                {error}
              </div>
            )}
            <div className="space-y-2">
              <Label className="studio-eyebrow" htmlFor="email">Email</Label>
              <div className="relative">
                <Mail className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-muted-foreground" />
                <Input className="studio-input pl-12" id="email" name="email" type="email" placeholder="ejemplo@correo.com" required />
              </div>
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-4">
                <Label className="studio-eyebrow" htmlFor="password">Contraseña</Label>
                <span className="text-sm font-semibold text-primary">Olvidé mi contraseña</span>
              </div>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-muted-foreground" />
                <Input className="studio-input px-12" id="password" name="password" type="password" placeholder="••••••••" required />
                <Eye className="pointer-events-none absolute right-4 top-1/2 size-5 -translate-y-1/2 text-muted-foreground" />
              </div>
            </div>
            <Button type="submit" className="h-14 w-full rounded-lg text-lg font-semibold shadow-[0_14px_32px_rgba(51,41,32,0.18)]" disabled={loading}>
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
