import Link from 'next/link'
import { Landmark } from 'lucide-react'

/**
 * Aviso destacado en el home cuando hay transferencias declaradas por clientas
 * pendientes de verificar. Presentacional y estático (server-safe): un
 * `verifyHours = null` puede congelar cupos, así que la dueña necesita verlo.
 */
export function PendingTransfersBanner({ count }: { count: number }) {
  if (count <= 0) return null

  return (
    <Link
      href="/dashboard/bookings"
      className="mb-8 flex items-start gap-3 rounded-xl border border-orange-300/50 bg-orange-50 p-4 text-sm text-orange-900 dark:border-orange-500/30 dark:bg-orange-500/10 dark:text-orange-200"
      role="alert"
    >
      <Landmark className="mt-0.5 size-4 shrink-0" />
      <p>
        <span className="font-semibold">
          {count === 1
            ? 'Tenés 1 transferencia por verificar'
            : `Tenés ${count} transferencias por verificar`}
        </span>{' '}
        — revisá tu cuenta y confirmá o rechazá cada reserva.
      </p>
    </Link>
  )
}
