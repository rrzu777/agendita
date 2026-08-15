import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'

/** Next entrega un array para `?cursor=a&cursor=b`. Un cursor sólo puede tener
 * un valor: ignorar ese input evita enviarlo por accidente a Prisma. */
export function getSingleSearchParam(value: string | string[] | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined
}

/**
 * Paginación basada en URL para listas Server Component. El browser conserva el
 * historial de páginas sin retener datasets completos en memoria del cliente.
 */
export function DashboardPagination({
  nextCursor,
  label,
  searchParam = 'cursor',
  preserve,
}: {
  nextCursor: string | null
  label: string
  searchParam?: string
  preserve?: Record<string, string | undefined>
}) {
  if (!nextCursor) return null
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(preserve ?? {})) {
    if (value) params.set(key, value)
  }
  params.set(searchParam, nextCursor)

  return (
    <div className="flex justify-center pt-2">
      <Button variant="outline" asChild>
        <Link href={`?${params.toString()}`} scroll={false}>
          {label}
          <ChevronRight className="size-4" />
        </Link>
      </Button>
    </div>
  )
}
