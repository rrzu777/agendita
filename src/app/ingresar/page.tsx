import Link from 'next/link'
import type { Metadata } from 'next'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { signInWithGoogle } from '@/lib/auth/actions'
import { GoogleButton } from './google-button'
import { sanitizeNext } from '@/lib/auth/sanitize-next'
import { AuthShell } from '@/components/platform/platform-shell'

export const metadata: Metadata = { title: 'Cuenta de cliente' }

async function signInWithGoogleAction(next: string | null) {
  'use server'
  await signInWithGoogle(next)
}

export default async function IngresarPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const { next, error } = await searchParams
  const action = signInWithGoogleAction.bind(null, next ?? null)
  const safeNext = sanitizeNext(next ?? null, '/mi')
  const bookingReturn = /^\/ir\/[A-Za-z0-9_-]+(?:\?|$)/.test(safeNext) ? safeNext : null

  return (
    <AuthShell audience="client">
      <main className="mx-auto w-full max-w-[440px]">
        <Card className="w-full border-border px-4 py-6 shadow-sm sm:px-8">
          <CardHeader className="px-0 text-left">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Acceso para clientes</p>
            <CardTitle className="font-heading text-3xl font-semibold tracking-tight text-primary"><h1>Ver mi cuenta</h1></CardTitle>
            <CardDescription className="text-base text-muted-foreground">
              Ingresa con tu cuenta de Google para ver tus reservas y tu tarjeta de beneficios.
            </CardDescription>
          </CardHeader>
          <CardContent className="px-0">
            {error && (
              <div role="alert" className="mb-6 rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">
                No se pudo iniciar sesión con Google. Intenta de nuevo.
              </div>
            )}
            <form action={action} noValidate>
              <GoogleButton />
            </form>
            {bookingReturn && (
              <Link href={bookingReturn} prefetch={false} className="mt-5 block rounded-full border border-border px-4 py-3 text-center font-semibold text-primary hover:bg-secondary">
                Volver a mi reserva sin iniciar sesión
              </Link>
            )}
            <div className="my-8 h-px bg-border/50" />
            <p className="text-center text-base text-muted-foreground">
              ¿Administras un negocio?{' '}
              <Link href="/login" className="inline-flex min-h-11 items-center font-semibold text-primary hover:underline">
                Ingresa aquí
              </Link>
            </p>
          </CardContent>
        </Card>
      </main>
    </AuthShell>
  )
}
