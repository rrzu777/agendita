import { Skeleton } from '@/components/ui/skeleton'

// Superficie personal de la clienta. El contenedor (max-w-2xl) y el header los
// pone mi/layout.tsx; este boundary solo rellena el área de contenido mientras
// la page resuelve sus datos.
export default function MiLoading() {
  return (
    <div className="pb-10">
      <Skeleton className="h-6 w-40" />
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-2xl border border-border/60 bg-card px-4 py-4">
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="mt-2 h-4 w-1/3" />
          </div>
        ))}
      </div>
    </div>
  )
}
