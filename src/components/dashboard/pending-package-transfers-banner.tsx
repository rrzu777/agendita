import Link from 'next/link'
import { Package } from 'lucide-react'

/**
 * Aviso destacado en el home cuando hay transferencias declaradas por clientas
 * de PAQUETES pendientes de verificar. Separado de PendingTransfersBanner
 * porque las compras de paquete viven en PackagePurchase, no en bookings.
 */
export function PendingPackageTransfersBanner({ count }: { count: number }) {
  if (count <= 0) return null

  return (
    <Link
      href="/dashboard/paquetes"
      className="mb-8 flex items-start gap-3 rounded-xl border border-orange-300/50 bg-orange-50 p-4 text-sm text-orange-900 dark:border-orange-500/30 dark:bg-orange-500/10 dark:text-orange-200"
      role="alert"
    >
      <Package className="mt-0.5 size-4 shrink-0" />
      <p>
        <span className="font-semibold">
          {count === 1
            ? 'Tenés 1 transferencia de paquete por verificar'
            : `Tenés ${count} transferencias de paquete por verificar`}
        </span>{' '}
        — revisá tu cuenta y confirmá o rechazá cada compra.
      </p>
    </Link>
  )
}
