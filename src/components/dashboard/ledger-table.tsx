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
  neutral: 'bg-muted text-muted-foreground',
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- entries shape depends on server action return type
export function LedgerTable({ entries }: { entries: any[] }) {
  return (
    <div className="studio-card overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/50">
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
              <TableCell colSpan={5} className="py-12 text-center text-muted-foreground">
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
                <TableCell className={`font-semibold ${entry.direction === 'income' ? 'text-green-700' : entry.direction === 'expense' ? 'text-destructive' : 'text-primary'}`}>
                  {entry.direction === 'expense' ? '-' : ''}${entry.amount.toLocaleString('es-CL')}
                </TableCell>
                <TableCell className="text-muted-foreground">{entry.description || '—'}</TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  )
}
