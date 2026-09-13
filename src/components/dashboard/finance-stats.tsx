import { formatMoney } from '@/lib/money'
import { KpiStrip } from '@/components/dashboard/kpi-strip'

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- summary shape depends on server action return type
export function FinanceStats({ summary, currency }: { summary: any; currency: string }) {
  const stats = [
    { label: 'Ingresos hoy', value: formatMoney(summary.incomeToday, currency), description: 'Cobros de reservas de hoy' },
    { label: 'Ingresos del mes', value: formatMoney(summary.incomeMonth, currency), description: 'Cobros de reservas del mes' },
    // Aditivo a "Ingresos hoy/mes" (que excluyen paquetes): venta de paquete NETA de reembolsos,
    // ventaneada a hoy/mes. Ver getFinancialSummary en src/server/actions/ledger.ts.
    { label: 'Paquetes hoy', value: formatMoney(summary.packageIncomeToday, currency), description: 'Venta neta de reembolsos' },
    { label: 'Paquetes del mes', value: formatMoney(summary.packageIncomeMonth, currency), description: 'Venta neta de reembolsos' },
    { label: 'Total abonado', value: formatMoney(summary.totalDeposited, currency), description: 'Abonos registrados' },
    { label: 'Pendiente por cobrar', value: formatMoney(summary.totalPending, currency), description: 'Saldo aún no registrado', tone: 'warning' as const },
    { label: 'Reservas', value: summary.totalBookings, description: 'Total del período' },
    { label: 'Completadas', value: summary.completedBookings, description: 'Total del período', tone: 'success' as const },
    { label: 'Canceladas', value: summary.cancelledBookings, description: 'Total del período' },
    { label: 'Reembolsos', value: formatMoney(summary.totalRefunded, currency), description: 'Monto registrado' },
  ]

  return (
    <div data-tour-id="payments-stats">
      <KpiStrip
        label="Resumen financiero"
        items={stats}
        className="min-[1100px]:!grid min-[1100px]:grid-cols-5"
      />
    </div>
  )
}
