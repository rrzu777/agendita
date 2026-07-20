import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatMoney } from '@/lib/money'
import { Banknote, CalendarCheck2, CreditCard, Package, RotateCcw } from 'lucide-react'

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- summary shape depends on server action return type
export function FinanceStats({ summary }: { summary: any }) {
  const stats = [
    { label: 'Ingresos hoy', value: formatMoney(summary.incomeToday), icon: Banknote },
    { label: 'Ingresos mes', value: formatMoney(summary.incomeMonth), icon: CreditCard },
    // Aditivo a "Ingresos hoy/mes" (que excluyen paquetes): venta de paquete NETA de reembolsos,
    // ventaneada a hoy/mes. Ver getFinancialSummary en src/server/actions/ledger.ts.
    { label: 'Venta de paquetes (hoy)', value: formatMoney(summary.packageIncomeToday), icon: Package },
    { label: 'Venta de paquetes (mes)', value: formatMoney(summary.packageIncomeMonth), icon: Package },
    { label: 'Total abonado', value: formatMoney(summary.totalDeposited), icon: CalendarCheck2 },
    { label: 'Pendiente por cobrar', value: formatMoney(summary.totalPending), icon: Banknote },
    { label: 'Reservas', value: summary.totalBookings, icon: CalendarCheck2 },
    { label: 'Completadas', value: summary.completedBookings, icon: CalendarCheck2 },
    { label: 'Canceladas', value: summary.cancelledBookings, icon: RotateCcw },
    { label: 'Reembolsos', value: formatMoney(summary.totalRefunded), icon: RotateCcw },
  ]

  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      {stats.map((stat) => {
        const Icon = stat.icon
        return (
        <Card key={stat.label} className="studio-card">
          <CardHeader className="pb-2">
            <div className="mb-2 flex size-10 items-center justify-center rounded-xl bg-secondary text-primary">
              <Icon className="size-5" />
            </div>
            <CardTitle className="text-sm font-semibold text-muted-foreground">{stat.label}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-heading font-semibold tracking-tight text-primary">{stat.value}</div>
          </CardContent>
        </Card>
        )
      })}
    </div>
  )
}
