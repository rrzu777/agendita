export default function Loading() {
  return (
    <div className="space-y-6 p-5 md:p-10" aria-busy="true" aria-label="Cargando métricas">
      <div className="h-24 animate-pulse rounded-xl bg-secondary/50" />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{Array.from({ length: 4 }, (_, index) => <div key={index} className="h-32 animate-pulse rounded-xl bg-card ring-1 ring-border/60" />)}</div>
      <div className="h-72 animate-pulse rounded-xl bg-card ring-1 ring-border/60" />
    </div>
  )
}
