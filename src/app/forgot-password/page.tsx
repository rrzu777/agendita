'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { FormField } from '@/components/ui/form-field'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { requestPasswordReset } from '@/lib/auth/actions'
import { Loader2, Mail } from 'lucide-react'
import { AuthShell } from '@/components/platform/platform-shell'

export default function ForgotPasswordPage() {
  const [error, setError] = useState('')
  const [sent, setSent] = useState(false)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(formData: FormData) {
    setError('')
    setLoading(true)
    try {
      const result = await requestPasswordReset(formData)
      if (result.error) {
        setError(result.error)
        return
      }
      setSent(true)
    } catch {
      setError('No pudimos enviar el enlace. Revisa tu conexión e intenta nuevamente.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthShell audience="owner"><main className="mx-auto w-full max-w-md">
      <Card className="w-full border-border px-4 py-6 shadow-sm sm:px-8">
        <CardHeader className="px-0 text-left">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Acceso para negocios</p>
          <CardTitle className="font-heading text-4xl font-semibold tracking-tight text-primary"><h1>Recuperar contraseña</h1></CardTitle>
          <CardDescription className="text-base text-muted-foreground">
            Te enviaremos un enlace para crear una nueva contraseña.
          </CardDescription>
        </CardHeader>
        <CardContent className="px-0">
          {sent ? (
            <div className="space-y-6">
              <div role="status" className="rounded-lg border border-success/30 bg-success/10 p-4 text-sm text-success">
                Revisa tu email y abre el enlace de recuperación.
              </div>
              <Link href="/login" className="inline-flex min-h-11 items-center font-semibold text-primary hover:underline">Volver al login</Link>
            </div>
          ) : (
            <form action={handleSubmit} noValidate className="space-y-6">
              {error && (
                <div role="alert" className="rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">
                  {error}
                </div>
              )}
              <FormField id="email" label="Email" required>
                {(a11y) => <div className="relative"><Mail className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-muted-foreground" /><Input className="pl-12" id="email" name="email" type="email" placeholder="ejemplo@correo.com" required density="touch" {...a11y} /></div>}
              </FormField>
              <Button type="submit" size="touch" className="w-full rounded-full font-semibold" disabled={loading}>
                {loading && <Loader2 className="mr-2 size-4 animate-spin" />}
                {loading ? 'Enviando...' : 'Enviar enlace'}
              </Button>
              <Link href="/login" className="flex min-h-11 items-center justify-center text-center font-semibold text-primary hover:underline">Volver al login</Link>
            </form>
          )}
        </CardContent>
      </Card>
    </main></AuthShell>
  )
}
