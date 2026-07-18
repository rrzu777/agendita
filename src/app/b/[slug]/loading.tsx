import { Skeleton } from '@/components/ui/skeleton'

// Perfil público del negocio — primera página que ve la clienta. Sin este
// boundary la navegación desde el funnel queda congelada hasta resolver la query
// pesada del perfil (reviews + _count). Refleja el layout de BusinessProfile.
export default function PublicProfileLoading() {
  return (
    <main className="studio-shell pb-28">
      <div className="mx-auto max-w-[420px] px-4 py-12">
        <section className="mb-10 text-center">
          <Skeleton className="mx-auto mb-6 size-28 rounded-full" />
          <Skeleton className="mx-auto h-7 w-48" />
          <Skeleton className="mx-auto mt-3 h-4 w-64 max-w-full" />
        </section>
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="rounded-2xl border border-border/60 bg-card p-4">
              <Skeleton className="h-5 w-1/2" />
              <Skeleton className="mt-2 h-4 w-1/3" />
            </div>
          ))}
        </div>
      </div>
    </main>
  )
}
