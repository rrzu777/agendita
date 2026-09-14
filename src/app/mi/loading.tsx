import { Skeleton } from '@/components/ui/skeleton'
import { ClientAccountShell } from '@/components/client/client-shell'

// Superficie personal de la clienta. El contenedor (max-w-2xl) y el header los
// pone mi/layout.tsx; este boundary solo rellena el área de contenido mientras
// la page resuelve sus datos.
export default function MiLoading() {
  return (
    <ClientAccountShell accountAction={<Skeleton className="h-11 w-16" />}>
    <div aria-busy="true" aria-label="Cargando cuenta">
      <Skeleton className="h-8 w-48" />
      <div className="mt-7 grid gap-4 sm:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="min-h-36 rounded-2xl border border-border bg-card p-5">
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="mt-2 h-4 w-1/3" />
          </div>
        ))}
      </div>
    </div>
    </ClientAccountShell>
  )
}
