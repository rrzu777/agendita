'use client'

import Link from 'next/link'
import { AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function ClientRouteError({
  area,
  error: _error,
  retry,
}: {
  area: 'account' | 'packages' | 'benefits' | 'review'
  error: Error & { digest?: string }
  retry: () => void
}) {
  void _error
  const labels = {
    account: 'Mi cuenta',
    packages: 'Paquetes',
    benefits: 'Tus beneficios',
    review: 'Tu reseña',
  } as const
  return (
    <div data-client-route-shell="" data-client-route-area={area} className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border/70 bg-card"><div className="mx-auto flex min-h-16 max-w-3xl items-center px-4 font-heading text-lg font-semibold text-primary">{labels[area]}</div></header>
      <main className="flex min-h-[calc(100vh-4rem)] items-center justify-center px-4 py-12">
      <section className="w-full max-w-md rounded-2xl border border-border bg-card p-6 text-center shadow-sm" aria-labelledby="client-error-title">
        <AlertCircle className="mx-auto size-10 text-destructive" aria-hidden="true" />
        <h1 id="client-error-title" className="mt-4 font-heading text-2xl font-semibold text-primary">No pudimos cargar esta página</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">Intenta nuevamente. Si el problema continúa, vuelve a tu cuenta y retoma desde allí.</p>
        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          <Button type="button" size="touch" onClick={retry}>Intentar de nuevo</Button>
          <Button asChild type="button" size="touch" variant="outline"><Link href="/mi">Volver a mi cuenta</Link></Button>
        </div>
      </section>
      </main>
    </div>
  )
}
