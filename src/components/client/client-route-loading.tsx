import { Skeleton } from '@/components/ui/skeleton'

export function ClientRouteLoading({ area, label = 'Cargando' }: { area: 'packages' | 'benefits' | 'review'; label?: string }) {
  const heading = area === 'packages' ? 'Paquetes' : area === 'benefits' ? 'Tus beneficios' : 'Tu reseña'
  const layout = area === 'packages' ? 'catalog' : area === 'benefits' ? 'benefit-card' : 'review-form'
  return (
    <div data-client-route-shell="" data-client-route-area={area} className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border/70 bg-card"><div className="mx-auto flex min-h-16 max-w-3xl items-center px-4 font-heading text-lg font-semibold text-primary">{heading}</div></header>
      <main data-loading-layout={layout} className={`mx-auto min-h-[calc(100vh-4rem)] w-full px-4 py-10 sm:px-6 ${area === 'review' ? 'max-w-xl' : 'max-w-3xl'}`} aria-busy="true" aria-label={label}>
      <Skeleton className="h-4 w-28" />
      <Skeleton className="mt-3 h-9 w-64 max-w-full" />
      <Skeleton className="mt-3 h-5 w-full max-w-xl" />
      {area === 'packages' && <div className="mt-8 grid gap-4 sm:grid-cols-2"><Skeleton data-loading-card="" className="h-44 rounded-2xl" /><Skeleton data-loading-card="" className="h-44 rounded-2xl" /></div>}
      {area === 'benefits' && <Skeleton data-loading-card="" className="mt-8 h-64 rounded-2xl" />}
      {area === 'review' && <div className="mt-8 space-y-5 rounded-2xl border border-border p-5"><div data-loading-rating="" className="flex gap-2">{Array.from({ length: 5 }, (_, index) => <Skeleton key={index} className="size-11 rounded-full" />)}</div><Skeleton data-loading-textarea="" className="h-32 rounded-xl" /><Skeleton className="h-12 w-full rounded-xl" /></div>}
      </main>
    </div>
  )
}
