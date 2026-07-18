import { Skeleton } from '@/components/ui/skeleton'

// Wizard de reserva. Refleja el shell de BookingBusinessPage (barra superior +
// contenido centrado max-w-2xl) para que el paso a reservar pinte al instante.
export default function BookLoading() {
  return (
    <main className="studio-shell">
      <div className="border-b border-border/50 bg-card/80 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-2xl items-center justify-between px-4">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-8 w-8 rounded-full" />
        </div>
      </div>
      <div className="mx-auto max-w-2xl px-4 py-8">
        <Skeleton className="h-7 w-56" />
        <div className="mt-6 space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="rounded-2xl border border-border/60 bg-card p-4">
              <Skeleton className="h-5 w-2/3" />
              <Skeleton className="mt-2 h-4 w-1/3" />
            </div>
          ))}
        </div>
      </div>
    </main>
  )
}
