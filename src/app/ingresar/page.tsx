import Link from 'next/link'
import type { Metadata } from 'next'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { signInWithGoogle } from '@/lib/auth/actions'

export const metadata: Metadata = { title: 'Ingresar — Agendita' }

async function signInWithGoogleAction(next: string | null) {
  'use server'
  await signInWithGoogle(next)
}

export default async function IngresarPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const { next, error } = await searchParams
  const action = signInWithGoogleAction.bind(null, next ?? null)

  return (
    <main className="studio-shell flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-[440px]">
        <div className="mb-10 text-center">
          <h1 className="font-heading text-6xl font-semibold tracking-tight text-primary">Agendita</h1>
          <p className="mt-3 text-xl text-muted-foreground">Tus reservas, puntos y beneficios</p>
        </div>
        <Card className="studio-card w-full border-border/40 px-4 py-6 sm:px-8">
          <CardHeader className="px-0 text-left">
            <CardTitle className="font-heading text-4xl font-semibold tracking-tight text-primary">Hola</CardTitle>
            <CardDescription className="text-base text-muted-foreground">
              Ingresa con tu cuenta de Google para ver tus reservas y tu tarjeta de beneficios.
            </CardDescription>
          </CardHeader>
          <CardContent className="px-0">
            {error && (
              <div className="mb-6 rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">
                No se pudo iniciar sesión con Google. Intenta de nuevo.
              </div>
            )}
            <form action={action}>
              <Button type="submit" className="h-14 w-full rounded-full text-lg font-semibold">
                Continuar con Google
              </Button>
            </form>
            <div className="my-8 h-px bg-border/50" />
            <p className="text-center text-base text-muted-foreground">
              ¿Administras un negocio?{' '}
              <Link href="/login" className="font-semibold text-primary hover:underline">
                Ingresa aquí
              </Link>
            </p>
          </CardContent>
        </Card>
      </div>
    </main>
  )
}
