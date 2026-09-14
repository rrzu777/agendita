import { Skeleton } from '@/components/ui/skeleton'

// Perfil público del negocio — primera página que ve la clienta. Sin este
// boundary la navegación desde el funnel queda congelada hasta resolver la query
// pesada del perfil (reviews + _count). Refleja el layout de BusinessProfile.
export default function PublicProfileLoading() {
  return (
    <main className="studio-shell pb-32">
      <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-10">
        <section className="mb-10 grid gap-7 border-b border-border pb-10 md:grid-cols-[minmax(0,1fr)_18rem]">
          <div><Skeleton className="mb-5 size-20 rounded-[var(--radius)]" /><Skeleton className="h-10 w-64 max-w-full" /><Skeleton className="mt-3 h-5 w-80 max-w-full" /></div>
          <Skeleton className="h-44 rounded-[var(--radius)]" />
        </section>
        <div className="grid gap-10 md:grid-cols-[minmax(0,1.55fr)_minmax(16rem,.75fr)]"><div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="rounded-2xl border border-border/60 bg-card p-4">
              <Skeleton className="h-5 w-1/2" />
              <Skeleton className="mt-2 h-4 w-1/3" />
            </div>
          ))}
        </div><Skeleton className="h-64 rounded-[var(--radius)]" /></div>
      </div>
    </main>
  )
}
