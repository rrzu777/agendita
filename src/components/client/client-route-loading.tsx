import { Skeleton } from '@/components/ui/skeleton'

export function ClientRouteLoading({ label = 'Cargando' }: { label?: string }) {
  return (
    <div data-client-route-shell="" className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border/70 bg-card"><div className="mx-auto flex min-h-16 max-w-3xl items-center px-4 font-heading text-lg font-semibold text-primary">Agendita</div></header>
      <main className="mx-auto min-h-[calc(100vh-4rem)] w-full max-w-3xl px-4 py-10 sm:px-6" aria-busy="true" aria-label={label}>
      <Skeleton className="h-4 w-28" />
      <Skeleton className="mt-3 h-9 w-64 max-w-full" />
      <Skeleton className="mt-3 h-5 w-full max-w-xl" />
      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        <Skeleton className="h-44 rounded-2xl" />
        <Skeleton className="h-44 rounded-2xl" />
      </div>
      </main>
    </div>
  )
}
