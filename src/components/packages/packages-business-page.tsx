import { PackageCatalog } from './package-catalog'
import type { PackagesBusiness } from '@/lib/business/public'
import type { PackageCheckoutPrefill } from '@/server/actions/packages-checkout'
import type { BankTransferPublicInfo } from '@/lib/bank-transfer/public-info'
import { TenantPublicShell } from '@/components/client/client-shell'

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
    <TenantPublicShell business={business} backHref={profileHref} backLabel="Volver al perfil">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Compra anticipada</p>
        <h1 className="mt-2 font-heading text-3xl font-semibold tracking-tight text-primary">Paquetes</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">Elige el paquete que mejor te sirve. Antes de pagar verás las sesiones, vigencia y métodos disponibles.</p>
        <div className="mt-7">
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
      </div>
    </TenantPublicShell>
  )
}
