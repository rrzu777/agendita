import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { TruncatedCell } from '@/components/ui/truncated-cell'
import { StatusBadge } from '@/components/ui/status-badge'
import { TableMobileCard } from '@/components/ui/table-mobile-card'
import { TABLE_COL, TABLE_MIN_WIDTH } from '@/components/ui/table-widths'
import { CreditCard } from 'lucide-react'

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
  package_sale: 'Venta de paquete',
}

function amountClassName(direction: string): string {
  return direction === 'income' ? 'text-green-700' : direction === 'expense' ? 'text-destructive' : 'text-primary'
}

function formatAmount(entry: { direction: string; amount: number }): string {
  return `${entry.direction === 'expense' ? '—' : ''}$${entry.amount.toLocaleString('es-CL')}`
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- entries shape depends on server action return type
export function LedgerTable({ entries }: { entries: any[] }) {
  if (entries.length === 0) {
    return (
      <div className="studio-card overflow-hidden">
        <div className="flex flex-col items-center gap-3 py-12 text-center">
          <div className="flex size-14 items-center justify-center rounded-full bg-muted">
            <CreditCard className="size-7 text-muted-foreground" />
          </div>
          <div>
            <p className="mb-1 text-base font-semibold text-primary">No hay movimientos registrados</p>
            <p className="text-sm text-muted-foreground">
              Los pagos aparecerán aquí cuando los clientes abonen o paguen.
            </p>
          </div>
        </div>
      </div>
    )
  }

  const rows = entries.map((entry) => ({
    entry,
    amountClass: amountClassName(entry.direction),
    amountLabel: formatAmount(entry),
  }))

  return (
    <>
      {/* Mobile: cards */}
      <div className="space-y-3 lg:hidden">
        {rows.map(({ entry, amountClass, amountLabel }) => (
          <TableMobileCard
            key={entry.id}
            title={typeLabels[entry.type] || entry.type}
            badge={<StatusBadge map="direction" status={entry.direction} />}
            rows={[
              { label: 'Fecha', value: new Date(entry.occurredAt).toLocaleDateString('es-CL') },
              {
                label: 'Monto',
                value: <span className={`font-semibold ${amountClass}`}>{amountLabel}</span>,
              },
              { label: 'Descripción', value: entry.description || '—' },
            ]}
          />
        ))}
      </div>

      {/* Desktop: table */}
      <div className="hidden lg:block studio-card overflow-hidden">
        <Table fixed className={TABLE_MIN_WIDTH}>
          <TableHeader>
            <TableRow className="bg-muted/50">
              <TableHead className={TABLE_COL.date}>Fecha</TableHead>
              <TableHead className={TABLE_COL.name}>Tipo</TableHead>
              <TableHead className={TABLE_COL.status}>Dirección</TableHead>
              <TableHead className={TABLE_COL.money}>Monto</TableHead>
              <TableHead>Descripción</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map(({ entry, amountClass, amountLabel }) => (
              <TableRow key={entry.id}>
                <TableCell className={TABLE_COL.date}>{new Date(entry.occurredAt).toLocaleDateString('es-CL')}</TableCell>
                <TruncatedCell className={TABLE_COL.name} primary={typeLabels[entry.type] || entry.type} />
                <TableCell className={TABLE_COL.status}>
                  <StatusBadge map="direction" status={entry.direction} />
                </TableCell>
                <TableCell className={`${TABLE_COL.money} whitespace-normal font-semibold ${amountClass}`}>
                  {amountLabel}
                </TableCell>
                <TruncatedCell className="text-muted-foreground" primary={entry.description || '—'} />
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  )
}
