import { Skeleton } from '@/components/ui/skeleton'

// Boundary de carga compartido por TODAS las páginas del dashboard que no tengan
// su propio loading.tsx. En Next (sin cacheComponents) una ruta dinámica SIN un
// loading boundary no se prefetchea y la navegación queda congelada hasta que el
// servidor termina render + queries; este skeleton habilita el prefetch parcial
// y hace que cada click del sidebar pinte al instante. El layout (sidebar) se
// preserva; solo se reemplaza el contenido del <main>.
export default function DashboardLoading() {
  return (
    <div>
      {/* Shell del header — mismas clases que DashboardHeader */}
      <header className="border-b border-border/50 bg-card/80 px-5 py-5 backdrop-blur md:px-10">
        <Skeleton className="h-9 w-64 md:h-10" />
        <Skeleton className="mt-2 h-5 w-80 max-w-full" />
      </header>

      <div className="p-5 md:p-10">
        {/* Fila de KPIs */}
        <div className="mb-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="rounded-xl border border-border/60 bg-card p-6">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="mt-3 h-8 w-16" />
            </div>
          ))}
        </div>

        {/* Bloque de contenido (tabla / lista) */}
        <div className="rounded-xl border border-border/60 bg-card p-6">
          <Skeleton className="h-6 w-40" />
          <div className="mt-6 space-y-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4">
                <Skeleton className="h-10 w-10 rounded-full" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-1/3" />
                  <Skeleton className="h-3 w-1/4" />
                </div>
                <Skeleton className="h-8 w-20" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
