import Link from 'next/link'
import { notFound } from 'next/navigation'
import { CheckCircle2, Clock, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { prisma } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth/user'
import { getTenantFromRequest } from '@/lib/tenant/resolver'
import { derivePackageConfirmationState } from '@/lib/payments/package-confirmation-state'
import { formatMoney } from '@/lib/money'

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
      product: { select: { name: true } },
      customer: { select: { userId: true } },
      business: { select: { name: true, slug: true, subdomain: true, currency: true } },
      payments: { select: { status: true } },
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
      iconColor: 'text-amber-500',
      iconBg: 'bg-amber-50',
      title: 'Procesando tu pago',
      message: 'Estamos procesando tu pago. Te confirmaremos cuando se acredite; podés refrescar esta página.',
    },
    rejected: {
      icon: XCircle,
      iconColor: 'text-destructive',
      iconBg: 'bg-destructive/10',
      title: 'Pago no aprobado',
      message: 'El pago no pudo procesarse. Podés intentar comprar de nuevo.',
    },
    expired: {
      icon: Clock,
      iconColor: 'text-muted-foreground',
      iconBg: 'bg-muted',
      title: 'Tu compra expiró',
      message: 'Se venció el tiempo para completar el pago. Podés iniciar la compra de nuevo.',
    },
    refunded: {
      icon: XCircle,
      iconColor: 'text-muted-foreground',
      iconBg: 'bg-muted',
      title: 'Compra reembolsada',
      message: 'Este pago fue reembolsado. Si tenés dudas, escribile al negocio.',
    },
    disputed: {
      icon: XCircle,
      iconColor: 'text-destructive',
      iconBg: 'bg-destructive/10',
      title: 'Compra revertida',
      message: 'Este pago fue reembolsado tras una disputa. Si tenés dudas, escribile al negocio.',
    },
  }[state]
  const Icon = config.icon

  return (
    <main className="studio-shell">
      <div className="mx-auto max-w-md px-4 py-12">
        <div className={`mx-auto mb-6 flex size-16 items-center justify-center rounded-full ${config.iconBg}`}>
          <Icon className={`size-8 ${config.iconColor}`} />
        </div>
        <h1 className="text-center font-heading text-2xl font-semibold text-primary">{config.title}</h1>
        <p className="mt-2 text-center text-muted-foreground">{config.message}</p>

        <div className="studio-card mt-6 p-4 text-sm">
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

        <div className="mt-6">
          <Button asChild className="h-12 w-full rounded-full">
            <Link href={cardHref}>Ver mis paquetes</Link>
          </Button>
        </div>
      </div>
    </main>
  )
}
