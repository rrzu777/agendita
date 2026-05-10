import { DashboardHeader } from '@/components/dashboard/header'
import { FinanceStats } from '@/components/dashboard/finance-stats'
import { LedgerTable } from '@/components/dashboard/ledger-table'
import { PaymentForm } from '@/components/dashboard/payment-form'
import { getFinancialSummary, getLedgerEntries } from '@/server/actions/ledger'
import { getBookings } from '@/server/actions/bookings'
import { Button } from '@/components/ui/button'
import { exportLedgerToCSV } from '@/lib/finance/csv-export'

export default async function PaymentsPage() {
  const summary = await getFinancialSummary()
  const entries = await getLedgerEntries()
  const bookings = await getBookings()

  const csvData = exportLedgerToCSV(entries)

  return (
    <div>
      <DashboardHeader title="Pagos y finanzas" />
      <div className="p-8 space-y-8">
        <FinanceStats summary={summary} />
        
        <div className="flex justify-between items-center">
          <h2 className="text-xl font-semibold">Historial de movimientos</h2>
          <div className="flex gap-3">
            <PaymentForm bookings={bookings} />
          </div>
        </div>
        
        <LedgerTable entries={entries} />
      </div>
    </div>
  )
}
