import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Banknote, CalendarCheck2, CreditCard, RotateCcw } from 'lucide-react'

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- summary shape depends on server action return type
export function FinanceStats({ summary }: { summary: any }) {
  const stats = [
    { label: 'Ingresos hoy', value: `$${summary.incomeToday.toLocaleString('es-CL')}`, icon: Banknote },
    { label: 'Ingresos mes', value: `$${summary.incomeMonth.toLocaleString('es-CL')}`, icon: CreditCard },
    { label: 'Total abonado', value: `$${summary.totalDeposited.toLocaleString('es-CL')}`, icon: CalendarCheck2 },
    { label: 'Pendiente por cobrar', value: `$${summary.totalPending.toLocaleString('es-CL')}`, icon: Banknote },
    { label: 'Reservas', value: summary.totalBookings, icon: CalendarCheck2 },
    { label: 'Completadas', value: summary.completedBookings, icon: CalendarCheck2 },
    { label: 'Canceladas', value: summary.cancelledBookings, icon: RotateCcw },
    { label: 'Reembolsos', value: `$${summary.totalRefunded.toLocaleString('es-CL')}`, icon: RotateCcw },
  ]

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
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
