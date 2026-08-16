import { redirect } from 'next/navigation'
import { DashboardHeader } from '@/components/dashboard/header'
import { FinanceStats } from '@/components/dashboard/finance-stats'
import { LedgerTable } from '@/components/dashboard/ledger-table'
import { PaymentForm } from '@/components/dashboard/payment-form'
import { ExportCSVButton } from '@/components/dashboard/export-csv-button'
import { getFinancialSummary, getLedgerEntriesPage } from '@/server/actions/ledger'
import { getManualPaymentBookings } from '@/server/actions/bookings'
import { getCurrentUserWithBusiness } from '@/lib/auth/user'
import { DashboardPagination, getSingleSearchParam } from '@/components/dashboard/dashboard-pagination'

export default async function PaymentsPage({
  searchParams,
}: {
  searchParams: Promise<{ cursor?: string | string[] }>
}) {
  const userData = await getCurrentUserWithBusiness()

  if (!userData?.user) {
    redirect('/login')
  }

  if (!userData?.business) {
    redirect('/recover-business')
  }

  const currency = userData.business.currency || 'CLP'
  const cursor = getSingleSearchParam((await searchParams).cursor)
  const [summary, ledgerPage, bookings] = await Promise.all([
    getFinancialSummary(),
    getLedgerEntriesPage({ cursor }),
    getManualPaymentBookings(),
  ])
  // Un solo reloj para el render: el diálogo de cobro es un componente cliente
  // y filtra por plazo vencido, así que el instante lo fija el servidor (ver
  // `isManualPaymentAllowed`).
  const now = new Date()

  return (
    <div>
      <DashboardHeader
        title="Pagos y finanzas"
        subtitle="Controla abonos, pagos finales y movimientos."
      />
      <div className="space-y-8 p-5 md:p-10">
        <FinanceStats summary={summary} currency={currency} />

        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-2xl font-heading font-semibold tracking-tight text-primary">Historial de movimientos</h2>
            <p className="text-sm text-muted-foreground">Ingresos, abonos y ajustes registrados.</p>
          </div>
          <div className="flex flex-wrap items-end justify-end gap-3">
            <PaymentForm bookings={bookings} now={now} />
            <ExportCSVButton />
          </div>
        </div>

        <LedgerTable entries={ledgerPage.items} currency={currency} />
        <DashboardPagination nextCursor={ledgerPage.nextCursor} label="Ver 50 movimientos más" />
      </div>
    </div>
  )
}
