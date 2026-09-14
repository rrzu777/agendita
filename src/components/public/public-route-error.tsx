'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { AlertCircle } from 'lucide-react'

export function PublicRouteError({ error, retry, backHref = '/' }: { error: Error & { digest?: string }; retry: () => void; backHref?: string }) {
  useEffect(() => { console.error(error) }, [error])
  return (
    <main className="min-h-screen bg-background px-4 py-12 text-foreground">
      <section className="mx-auto max-w-lg rounded-[var(--radius)] border border-border bg-card p-6 text-center sm:p-8">
        <AlertCircle className="mx-auto size-10 text-destructive" aria-hidden="true" />
        <h1 className="mt-4 font-heading text-2xl font-semibold text-primary">No pudimos cargar esta página</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">Revisa tu conexión y vuelve a intentarlo. Tu selección no se enviará de nuevo por esta acción.</p>
        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          <Button type="button" size="touch" className="flex-1" onClick={retry}>Reintentar</Button>
          <Button asChild variant="outline" size="touch" className="flex-1"><Link href={backHref}>Volver</Link></Button>
        </div>
      </section>
    </main>
  )
}
