import { Skeleton } from '@/components/ui/skeleton'

export function BookingRouteLoading() {
  return <main className="studio-shell min-h-screen"><div className="border-b border-border"><div className="mx-auto flex h-16 max-w-2xl items-center justify-between px-4"><Skeleton className="size-11 rounded-lg" /><Skeleton className="h-6 w-40" /><Skeleton className="size-11 rounded-lg" /></div></div><div className="mx-auto max-w-2xl px-4 py-6"><div className="grid grid-cols-6 gap-1.5">{Array.from({ length: 6 }).map((_, index) => <Skeleton key={index} className="h-11 rounded-lg" />)}</div><Skeleton className="mt-6 h-96 rounded-[var(--radius)]" /></div></main>
}
