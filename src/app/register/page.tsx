'use client'

import { useState, type FormEvent } from 'react'
import Link from 'next/link'
import { unstable_rethrow } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { FormField } from '@/components/ui/form-field'
import { Input } from '@/components/ui/input'
import { NativeSelect } from '@/components/ui/native-select'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { signUp } from '@/lib/auth/actions'
import { CheckCircle2, Eye, EyeOff, Loader2, Lock, Mail, User } from 'lucide-react'
import { AuthShell } from '@/components/platform/platform-shell'

export default function RegisterPage() {
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const [loading, setLoading] = useState(false)
  const [acceptedTerms, setAcceptedTerms] = useState(false)
  const [useServiceTemplate, setUseServiceTemplate] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const categories = [
    { value: 'other', label: 'Otro rubro / lo configuro después' },
    { value: 'nails', label: 'Uñas' },
    { value: 'barber', label: 'Barbería' },
    { value: 'hair_salon', label: 'Peluquería' },
    { value: 'beauty', label: 'Belleza / estética' },
    { value: 'massage', label: 'Masajes' },
    { value: 'therapy', label: 'Terapia / consulta' },
  ]

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    setError('')
    setSuccess(false)

    if (!acceptedTerms) {
      setError('Debes aceptar los términos y condiciones y la política de privacidad')
      return
    }

    setLoading(true)

    try {
      const formData = new FormData(event.currentTarget)
      const res = await signUp(formData)
      if (!res.ok) {
        setError(res.error)
        return
      }
      if (res.data.requiresEmailConfirmation) {
        setSuccess(true)
      }
    } catch (err) {
      // Net de transporte: la action ya no lanza errores de negocio, pero un
      // fallo de red sí. `err.message` acá es ruido interno → genérico.
      unstable_rethrow(err)
      setError('Error al crear cuenta')
    } finally {
      setLoading(false)
    }
  }

  if (success) {
    return (
      <AuthShell audience="owner"><main className="mx-auto w-full max-w-md">
        <Card className="w-full max-w-md border-border px-4 py-6 shadow-sm sm:px-8">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-xl bg-secondary text-primary">
              <CheckCircle2 className="size-6" />
            </div>
            <CardTitle className="font-heading text-3xl font-semibold tracking-tight text-primary"><h1>Verifica tu email</h1></CardTitle>
            <CardDescription>
              Te enviamos un email de confirmación. Haz clic en el enlace para activar tu cuenta.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-center text-sm text-muted-foreground">
              ¿Ya confirmaste?{' '}
              <Link href="/login" className="inline-flex min-h-11 items-center font-semibold text-primary hover:underline">
                Inicia sesión
              </Link>
            </p>
          </CardContent>
        </Card>
      </main></AuthShell>
    )
  }

  return (
    <AuthShell audience="owner">
      <main className="mx-auto w-full max-w-[440px]">
      <Card className="w-full border-border px-4 py-6 shadow-sm sm:px-8">
        <CardHeader className="px-0 text-left">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Configura tu negocio</p>
          <CardTitle className="font-heading text-4xl font-semibold tracking-tight text-primary"><h1>Crea tu cuenta</h1></CardTitle>
          <CardDescription className="text-base text-muted-foreground">Empieza a recibir reservas online</CardDescription>
        </CardHeader>
        <CardContent className="px-0">
          <form onSubmit={handleSubmit} noValidate className="space-y-6">
            {error && (
              <div role="alert" className="rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">
                {error}
              </div>
            )}
            <FormField id="name" label="Nombre" required>
              {(a11y) => <div className="relative"><User className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-muted-foreground" /><Input className="pl-12" id="name" name="name" placeholder="Tu nombre" required density="touch" {...a11y} /></div>}
            </FormField>
            <FormField id="email" label="Email" required>
              {(a11y) => <div className="relative"><Mail className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-muted-foreground" /><Input className="pl-12" id="email" name="email" type="email" placeholder="hola@tunegocio.cl" required density="touch" {...a11y} /></div>}
            </FormField>
            <FormField id="password" label="Contraseña" required help="Mínimo 6 caracteres">
              {(a11y) => <div className="relative"><Lock className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-muted-foreground" /><Input className="px-12" id="password" name="password" type={showPassword ? 'text' : 'password'} required minLength={6} autoComplete="new-password" density="touch" {...a11y} /><button type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'} aria-pressed={showPassword} className="absolute right-1 top-1/2 flex size-11 -translate-y-1/2 items-center justify-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-primary">{showPassword ? <EyeOff className="size-5" /> : <Eye className="size-5" />}</button></div>}
            </FormField>
            <FormField id="category" label="Rubro" required>
              {(a11y) => <NativeSelect id="category" name="category" defaultValue="other" density="touch" onChange={(e) => setUseServiceTemplate(e.target.value === 'nails')} {...a11y}>{categories.map((category) => <option key={category.value} value={category.value}>{category.label}</option>)}</NativeSelect>}
            </FormField>
            <div className="flex items-start gap-3">
              <input
                type="checkbox"
                id="useServiceTemplate"
                name="useServiceTemplate"
                value="true"
                checked={useServiceTemplate}
                onChange={(e) => setUseServiceTemplate(e.target.checked)}
                className="mt-3 size-5 rounded border-border accent-primary"
              />
              <label htmlFor="useServiceTemplate" className="flex min-h-11 items-center text-sm text-muted-foreground">
                Crear servicios de ejemplo para este rubro
              </label>
            </div>
            <div className="flex items-start gap-3">
              <input
                type="checkbox"
                id="accept-terms"
                required
                aria-required="true"
                aria-describedby="accept-terms-help"
                checked={acceptedTerms}
                onChange={(e) => setAcceptedTerms(e.target.checked)}
                className="mt-3 size-5 rounded border-border accent-primary"
              />
              <input type="hidden" name="acceptedTerms" value={acceptedTerms ? 'true' : 'false'} />
              <label htmlFor="accept-terms" className="flex min-h-11 flex-wrap items-center gap-x-1 text-sm text-muted-foreground">
                Acepto los{' '}
                <a href="/terms" target="_blank" className="inline-flex min-h-11 items-center font-semibold text-primary underline">
                  Términos y Condiciones
                </a>{' '}
                y la{' '}
                <a href="/privacy" target="_blank" className="inline-flex min-h-11 items-center font-semibold text-primary underline">
                  Política de Privacidad
                </a>{' '}
                y la{' '}
                <a href="/refund-policy" target="_blank" className="inline-flex min-h-11 items-center font-semibold text-primary underline">
                  Política de Reembolsos y Cancelación
                </a>
              </label>
            </div>
            <p id="accept-terms-help" className="-mt-4 text-xs leading-relaxed text-muted-foreground">Requerido para crear la cuenta. Los documentos se abren en otra pestaña para que no pierdas los datos ingresados.</p>
            <Button
              type="submit"
              size="touch"
              className="w-full rounded-full font-semibold shadow-sm"
              disabled={loading || !acceptedTerms}
              data-auth-loading={loading ? 'true' : undefined}
              aria-busy={loading}
            >
              {loading && <Loader2 className="mr-2 size-4 animate-spin" />}
              {loading ? 'Creando cuenta...' : 'Crear cuenta'}
            </Button>
          </form>
          <p className="mt-8 text-center text-base text-muted-foreground">
            ¿Ya tienes cuenta?{' '}
            <Link href="/login" className="inline-flex min-h-11 items-center font-semibold text-primary hover:underline">
              Inicia sesión
            </Link>
          </p>
        </CardContent>
      </Card>
      </main>
    </AuthShell>
  )
}
