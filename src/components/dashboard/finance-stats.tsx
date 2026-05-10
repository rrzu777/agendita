import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export function FinanceStats({ summary }: { summary: any }) {
  const stats = [
    { label: 'Ingresos hoy', value: `$${summary.incomeToday.toLocaleString('es-CL')}`, color: 'text-green-600' },
    { label: 'Ingresos mes', value: `$${summary.incomeMonth.toLocaleString('es-CL')}`, color: 'text-green-600' },
    { label: 'Total abonado', value: `$${summary.totalDeposited.toLocaleString('es-CL')}`, color: 'text-blue-600' },
    { label: 'Pendiente por cobrar', value: `$${summary.totalPending.toLocaleString('es-CL')}`, color: 'text-yellow-600' },
    { label: 'Reservas', value: summary.totalBookings, color: 'text-gray-900' },
    { label: 'Completadas', value: summary.completedBookings, color: 'text-blue-600' },
    { label: 'Canceladas', value: summary.cancelledBookings, color: 'text-red-600' },
    { label: 'Reembolsos', value: `$${summary.totalRefunded.toLocaleString('es-CL')}`, color: 'text-red-600' },
  ]

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {stats.map((stat) => (
        <Card key={stat.label}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-500">{stat.label}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${stat.color}`}>{stat.value}</div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
