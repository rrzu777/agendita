import Link from 'next/link'
import { notFound } from 'next/navigation'
import { CheckCircle2, Clock, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { prisma } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth/user'
import { getTenantFromRequest } from '@/lib/tenant/resolver'
import { derivePackageConfirmationState, isPackageOfferUnchanged } from '@/lib/payments/package-confirmation-state'
import { PKG_TRANSFER_PAYMENT_METHOD } from '@/lib/bank-transfer/declared'
import { formatMoney } from '@/lib/money'
import { PackageTransferPanel } from './transfer-panel'
import { getBankTransferInfo } from '@/server/actions/bank-transfer-public'
import { TenantPublicShell } from '@/components/client/client-shell'
import type { Metadata } from 'next'
import { RefreshStatusButton } from './refresh-status-button'

export const metadata: Metadata = { title: 'Estado de compra', robots: { index: false, follow: false } }

interface ConfirmationPageProps {
  searchParams: Promise<{ purchaseId?: string }>
}

export default async function PackageConfirmationPage({ searchParams }: ConfirmationPageProps) {
  const { purchaseId } = await searchParams

  if (!purchaseId) {
    notFound()
  }

  const user = await getCurrentUser()

  if (!user) {
    notFound()
  }

  const purchase = await prisma.packagePurchase.findUnique({
    where: { id: purchaseId },
    include: {
      product: { select: { name: true, isActive: true, price: true } },
      customer: { select: { userId: true } },
      business: { select: { name: true, slug: true, subdomain: true, logoUrl: true, brandColor: true, visualStyle: true, category: true, currency: true } },
      payments: { select: { status: true, provider: true, providerPaymentId: true } },
    },
  })

  if (!purchase) {
    notFound()
  }

  const tenant = await getTenantFromRequest()

  if (tenant && tenant.businessId !== purchase.businessId) {
    notFound()
  }

  if (purchase.customer.userId !== user.id) {
    notFound()
  }

  const state = derivePackageConfirmationState(purchase)
  const cardHref = tenant ? '/mi' : `/mi/${purchase.business.slug}`
  const totalSessions = purchase.quantity + purchase.bonusQuantity

  // Superficie activa: en awaiting_transfer siempre; en expired sólo si la compra
  // sigue retomable (era transferencia + producto vigente al mismo precio + el
  // negocio mantiene transferencia habilitada). El guard server-side real vive en
  // declarePackageTransfer; esto sólo decide si mostrar el panel.
  const wantsTransferPanel =
    state === 'awaiting_transfer' ||
    (state === 'expired' &&
      purchase.paymentMethod === PKG_TRANSFER_PAYMENT_METHOD &&
      isPackageOfferUnchanged(purchase.product, purchase))
  const transferInfo = wantsTransferPanel ? await getBankTransferInfo(purchase.businessId) : null
  const showTransferPanel = wantsTransferPanel && transferInfo != null

  const config = {
    active: {
      icon: CheckCircle2,
      iconColor: 'text-primary',
      iconBg: 'bg-primary/10',
      title: '¡Paquete listo!',
      message: `Tu paquete ${purchase.product.name} está activo con ${totalSessions} sesiones disponibles.`,
    },
    pending: {
      icon: Clock,
      iconColor: 'text-warning',
      iconBg: 'bg-warning/10',
      title: 'Procesando tu pago',
      message: 'Estamos procesando tu pago. Te confirmaremos cuando se acredite; puedes actualizar esta página.',
    },
    awaiting_transfer: {
      icon: Clock,
      iconColor: 'text-warning',
      iconBg: 'bg-warning/10',
      title: 'Te falta transferir',
      // Sin panel (el negocio pausó las transferencias entremedio) el copy no puede
      // referenciar datos bancarios ni el botón "Ya transferí" que no se renderizan.
      message: showTransferPanel
        ? 'Reservamos tu paquete. Transfiere y avísanos con "Ya transferí" para que el negocio confirme tu compra.'
        : 'Reservamos tu paquete, pero el negocio pausó los pagos por transferencia. Escríbele para coordinar el pago.',
    },
    rejected: {
      icon: XCircle,
      iconColor: 'text-destructive',
      iconBg: 'bg-destructive/10',
      title: 'Pago no aprobado',
      message: 'El pago no pudo procesarse. Puedes intentar comprar de nuevo.',
    },
    expired: {
      icon: Clock,
      iconColor: 'text-muted-foreground',
      iconBg: 'bg-muted',
      title: 'Tu compra expiró',
      message: showTransferPanel
        ? 'Se venció el plazo, pero todavía puedes retomarla: transfiere y avísanos con "Ya transferí".'
        : 'Se venció el tiempo para completar el pago. Puedes iniciar la compra de nuevo.',
    },
    refunded: {
      icon: XCircle,
      iconColor: 'text-muted-foreground',
      iconBg: 'bg-muted',
      title: 'Compra reembolsada',
      message: 'Este pago fue reembolsado. Si tienes dudas, escríbele al negocio.',
    },
    disputed: {
      icon: XCircle,
      iconColor: 'text-destructive',
      iconBg: 'bg-destructive/10',
      title: 'Compra revertida',
      message: 'Este pago fue reembolsado tras una disputa. Si tienes dudas, escríbele al negocio.',
    },
  }[state]
  const Icon = config.icon
  const catalogHref = `/paquetes/${purchase.business.slug}`
  const shouldReturnToCatalog = state === 'rejected' || (state === 'expired' && !showTransferPanel)
  const actionHref = shouldReturnToCatalog ? catalogHref : cardHref
  const actionLabel = shouldReturnToCatalog ? 'Comprar otro paquete' : 'Ver mis paquetes'

  return (
    <TenantPublicShell business={purchase.business} backHref={cardHref} backLabel="Volver a mi cuenta" width="narrow">
      <div>
        <div className={`mx-auto mb-6 flex size-16 items-center justify-center rounded-full ${config.iconBg}`}>
          <Icon className={`size-8 ${config.iconColor}`} />
        </div>
        <h1 className="text-center font-heading text-2xl font-semibold text-primary">{config.title}</h1>
        <p className="mt-2 text-center text-muted-foreground">{config.message}</p>

        <div className="mt-6 rounded-[var(--radius)] border border-border bg-card p-4 text-sm shadow-sm">
          <div className="flex justify-between py-1">
            <span className="text-muted-foreground">Paquete</span>
            <span className="font-semibold">{purchase.product.name}</span>
          </div>
          <div className="flex justify-between py-1">
            <span className="text-muted-foreground">Sesiones</span>
            <span className="font-semibold">{totalSessions}</span>
          </div>
          <div className="flex justify-between py-1">
            <span className="text-muted-foreground">Total</span>
            <span className="font-semibold">{formatMoney(purchase.pricePaid, purchase.business.currency || 'CLP')}</span>
          </div>
        </div>

        {showTransferPanel && (
          <PackageTransferPanel
            transferInfo={transferInfo}
            amount={purchase.pricePaid}
            currency={purchase.business.currency || 'CLP'}
            purchaseId={purchase.id}
          />
        )}

        <div className="mt-6">
          {state === 'pending' ? (
            <RefreshStatusButton />
          ) : (
            <Button asChild className="h-12 w-full rounded-full"><Link href={actionHref}>{actionLabel}</Link></Button>
          )}
        </div>
      </div>
    </TenantPublicShell>
  )
}
