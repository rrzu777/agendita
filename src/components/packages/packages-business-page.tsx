import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { PackageCatalog } from './package-catalog'
import type { PackagesBusiness } from '@/lib/business/public'
import type { PackageCheckoutPrefill } from '@/server/actions/packages-checkout'
import type { BankTransferPublicInfo } from '@/lib/bank-transfer/public-info'

interface PackagesBusinessPageProps {
  business: PackagesBusiness
  profileHref: string
  onlineAvailable: boolean
  onlineReason: string | null
  prefill: PackageCheckoutPrefill | null
  preselectedProductId?: string
  transferInfo: BankTransferPublicInfo | null
}

export function PackagesBusinessPage({ business, profileHref, onlineAvailable, onlineReason, prefill, preselectedProductId, transferInfo }: PackagesBusinessPageProps) {
  return (
    <main className="studio-shell">
      <header className="sticky top-0 z-40 border-b border-border/50 bg-background/85 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-2xl items-center justify-between px-4">
          <Link href={profileHref} className="flex size-10 items-center justify-center rounded-full text-primary transition-colors hover:bg-muted" aria-label="Volver al perfil">
            <ArrowLeft className="size-6" />
          </Link>
          <div className="text-center">
            <h1 className="font-heading text-xl font-semibold tracking-tight text-primary">Paquetes</h1>
            <p className="text-sm text-muted-foreground">{business.name}</p>
          </div>
          <div className="flex size-10 items-center justify-center rounded-full bg-secondary text-sm font-semibold text-primary">
            {business.name.slice(0, 1).toUpperCase()}
          </div>
        </div>
      </header>
      <div className="mx-auto max-w-2xl px-4 py-8">
        <PackageCatalog
          slug={business.slug}
          currency={business.currency || 'CLP'}
          products={business.packageProducts.map((p) => ({
            id: p.id,
            name: p.name,
            quantity: p.quantity,
            bonusQuantity: p.bonusQuantity,
            price: p.price,
            expiryDays: p.expiryDays,
            appliesToAll: p.appliesToAll,
            serviceNames: p.services.map((s) => s.name),
          }))}
          onlineAvailable={onlineAvailable}
          onlineReason={onlineReason}
          isLoggedIn={!!prefill}
          prefill={prefill}
          preselectedProductId={preselectedProductId}
          transferInfo={transferInfo}
        />
      </div>
    </main>
  )
}
