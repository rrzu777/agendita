import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'

const directionLabels: Record<string, string> = {
  income: 'Ingreso',
  expense: 'Gasto',
  neutral: 'Neutral',
}

const directionColors: Record<string, string> = {
  income: 'bg-green-100 text-green-800',
  expense: 'bg-red-100 text-red-800',
  neutral: 'bg-gray-100 text-gray-800',
}

const typeLabels: Record<string, string> = {
  booking_created: 'Reserva creada',
  deposit_paid: 'Abono pagado',
  final_payment_paid: 'Pago final',
  full_payment_paid: 'Pago total',
  refund_issued: 'Reembolso',
  discount_applied: 'Descuento',
  cancellation_fee_charged: 'Cargo por cancelación',
  manual_income: 'Ingreso manual',
  manual_expense: 'Gasto manual',
  adjustment: 'Ajuste',
}

export function LedgerTable({ entries }: { entries: any[] }) {
  return (
    <div className="bg-white rounded-lg shadow-sm border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Fecha</TableHead>
            <TableHead>Tipo</TableHead>
            <TableHead>Dirección</TableHead>
            <TableHead>Monto</TableHead>
            <TableHead>Descripción</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {entries.length === 0 ? (
            <TableRow>
              <TableCell colSpan={5} className="text-center text-gray-500 py-8">
                No hay movimientos registrados
              </TableCell>
            </TableRow>
          ) : (
            entries.map((entry) => (
              <TableRow key={entry.id}>
                <TableCell>{new Date(entry.occurredAt).toLocaleDateString('es-CL')}</TableCell>
                <TableCell>{typeLabels[entry.type] || entry.type}</TableCell>
                <TableCell>
                  <Badge className={directionColors[entry.direction]}>
                    {directionLabels[entry.direction]}
                  </Badge>
                </TableCell>
                <TableCell className={`font-medium ${entry.direction === 'income' ? 'text-green-600' : entry.direction === 'expense' ? 'text-red-600' : ''}`}>
                  {entry.direction === 'expense' ? '-' : ''}${entry.amount.toLocaleString('es-CL')}
                </TableCell>
                <TableCell className="text-gray-600">{entry.description || '—'}</TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  )
}
