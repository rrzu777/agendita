'use client'

import { Button } from '@/components/ui/button'

export default function Error({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <div className="p-5 md:p-10">
      <section className="max-w-xl rounded-xl border border-destructive/30 bg-card p-6">
        <h2 className="font-heading text-2xl font-semibold text-primary">No fue posible cargar las métricas</h2>
        <p className="mt-2 text-sm text-muted-foreground">No mostramos valores simulados ni ceros cuando el reporte falla. Intenta nuevamente.</p>
        <Button className="mt-4" onClick={retry}>Reintentar</Button>
      </section>
    </div>
  )
}
