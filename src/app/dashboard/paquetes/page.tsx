import { redirect } from 'next/navigation'
import { DashboardHeader } from '@/components/dashboard/header'
import { getCurrentUserWithBusiness } from '@/lib/auth/user'
import { listPackageProducts, getPackageSalesTotal } from '@/server/actions/packages'
import { getServices } from '@/server/actions/services'
import { formatMoney } from '@/lib/money'
import { PackageCatalog } from './package-catalog'

export default async function PaquetesPage() {
  const userData = await getCurrentUserWithBusiness()

  if (!userData?.user) {
    redirect('/login')
  }

  if (!userData?.business) {
    redirect('/recover-business')
  }

  const [products, services, salesTotal] = await Promise.all([
    listPackageProducts(),
    getServices(),
    getPackageSalesTotal(),
  ])

  const currency = userData.business.currency

  return (
    <div>
      <DashboardHeader
        title="Paquetes"
        subtitle="Vendé paquetes de sesiones prepagadas."
      />
      <div className="p-5 md:p-10">
        <div className="mx-auto max-w-2xl">
          <p className="text-sm text-muted-foreground">
            Total vendido: <span className="font-semibold text-primary">{formatMoney(salesTotal, currency)}</span>
          </p>
          <PackageCatalog products={products} services={services} currency={currency} />
        </div>
      </div>
    </div>
  )
}
