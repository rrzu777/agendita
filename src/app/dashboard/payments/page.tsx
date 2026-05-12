import { redirect } from 'next/navigation'
import { DashboardHeader } from '@/components/dashboard/header'
import { FinanceStats } from '@/components/dashboard/finance-stats'
import { LedgerTable } from '@/components/dashboard/ledger-table'
import { PaymentForm } from '@/components/dashboard/payment-form'
import { getFinancialSummary, getLedgerEntries } from '@/server/actions/ledger'
import { getBookings } from '@/server/actions/bookings'
import { getCurrentUserWithBusiness } from '@/lib/auth/user'

export default async function PaymentsPage() {
  const userData = await getCurrentUserWithBusiness()

  if (!userData?.business) {
    redirect('/login')
  }

  const summary = await getFinancialSummary(userData.business.id)
  const entries = await getLedgerEntries(userData.business.id)
  const bookings = await getBookings(userData.business.id)

  return (
    <div>
      <DashboardHeader title="Pagos y finanzas" subtitle="Controla abonos, pagos finales y movimientos manuales." />
      <div className="space-y-8 p-5 md:p-10">
        <FinanceStats summary={summary} />
        
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-2xl font-semibold tracking-normal text-primary">Historial de movimientos</h2>
            <p className="text-sm text-muted-foreground">Últimos ingresos, ajustes y pagos registrados.</p>
          </div>
          <div className="flex gap-3">
            <PaymentForm bookings={bookings} businessId={userData.business.id} />
          </div>
        </div>
        
        <LedgerTable entries={entries} />
      </div>
    </div>
  )
}
