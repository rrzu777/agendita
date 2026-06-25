import { redirect } from 'next/navigation'
import { DashboardHeader } from '@/components/dashboard/header'
import { FinanceStats } from '@/components/dashboard/finance-stats'
import { LedgerTable } from '@/components/dashboard/ledger-table'
import { PaymentForm } from '@/components/dashboard/payment-form'
import { ExportCSVButton } from '@/components/dashboard/export-csv-button'
import { getFinancialSummary, getLedgerEntries } from '@/server/actions/ledger'
import { getBookings } from '@/server/actions/bookings'
import { getCurrentUserWithBusiness } from '@/lib/auth/user'

export default async function PaymentsPage() {
  const userData = await getCurrentUserWithBusiness()

  if (!userData?.user) {
    redirect('/login')
  }

  if (!userData?.business) {
    redirect('/recover-business')
  }

  const summary = await getFinancialSummary()
  const entries = await getLedgerEntries()
  const bookings = await getBookings()

  return (
    <div>
      <DashboardHeader
        title="Pagos y finanzas"
        subtitle="Controla abonos, pagos finales y movimientos."
      />
      <div className="space-y-8 p-5 md:p-10">
        <FinanceStats summary={summary} />

        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-2xl font-heading font-semibold tracking-tight text-primary">Historial de movimientos</h2>
            <p className="text-sm text-muted-foreground">Ingresos, abonos y ajustes registrados.</p>
          </div>
          <div className="flex flex-wrap gap-3">
            <PaymentForm bookings={bookings} />
            <ExportCSVButton />
          </div>
        </div>

        <LedgerTable entries={entries} />
      </div>
    </div>
  )
}
