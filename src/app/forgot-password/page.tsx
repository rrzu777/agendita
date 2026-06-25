'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { requestPasswordReset } from '@/lib/auth/actions'
import { Loader2, Mail, Sparkles } from 'lucide-react'

export default function ForgotPasswordPage() {
  const [error, setError] = useState('')
  const [sent, setSent] = useState(false)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(formData: FormData) {
    setError('')
    setLoading(true)
    const result = await requestPasswordReset(formData)
    setLoading(false)

    if (result.error) {
      setError(result.error)
      return
    }
    setSent(true)
  }

  return (
    <main className="studio-shell flex items-center justify-center px-4 py-12">
      <Card className="studio-card w-full max-w-md border-border/40 px-4 py-6 sm:px-8">
        <CardHeader className="px-0 text-left">
          <div className="mb-2 flex size-11 items-center justify-center rounded-xl bg-secondary text-primary">
            <Sparkles className="size-5" />
          </div>
          <CardTitle className="font-heading text-4xl font-semibold tracking-tight text-primary">Recuperar contraseña</CardTitle>
          <CardDescription className="text-base text-muted-foreground">
            Te enviaremos un enlace para crear una nueva contraseña.
          </CardDescription>
        </CardHeader>
        <CardContent className="px-0">
          {sent ? (
            <div className="space-y-6">
              <div className="rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-800">
                Revisa tu email y abre el enlace de recuperación.
              </div>
              <Link href="/login" className="font-semibold text-primary hover:underline">Volver al login</Link>
            </div>
          ) : (
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
              <Button type="submit" className="h-14 w-full rounded-full text-lg font-semibold" disabled={loading}>
                {loading && <Loader2 className="mr-2 size-4 animate-spin" />}
                {loading ? 'Enviando...' : 'Enviar enlace'}
              </Button>
              <Link href="/login" className="block text-center font-semibold text-primary hover:underline">Volver al login</Link>
            </form>
          )}
        </CardContent>
      </Card>
    </main>
  )
}
