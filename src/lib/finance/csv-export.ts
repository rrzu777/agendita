import { formatInTimeZone } from 'date-fns-tz'

const CSV_HEADERS = [
  'fecha',
  'tipo_movimiento',
  'direccion',
  'cliente',
  'telefono_cliente',
  'servicio',
  'booking_id',
  'payment_id',
  'monto',
  'moneda',
  'metodo_pago',
  'proveedor',
  'estado_pago',
  'descripcion',
]

const INJECTION_TRIGGERS = ['=', '+', '-', '@', '\t', '\r']

function protectCSVInjection(value: string): string {
  const trimmed = value.replace(/^ +/, '')
  if (trimmed.length > 0 && INJECTION_TRIGGERS.includes(trimmed[0])) {
    return "'" + value
  }
  return value
}

function escapeCSVField(value: unknown): string {
  const str = protectCSVInjection(String(value ?? ''))
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return '"' + str.replace(/"/g, '""') + '"'
  }
  return str
}

export interface LedgerCSVEntry {
  occurredAt: Date
  type: string
  direction: string
  customerName?: string | null
  customerPhone?: string | null
  serviceName?: string | null
  bookingId?: string | null
  paymentId?: string | null
  amount: number
  currency?: string | null
  paymentMethod?: string | null
  provider?: string | null
  paymentStatus?: string | null
  description?: string | null
}

export function buildLedgerCSV(entries: LedgerCSVEntry[], timezone: string): string {
  const headerLine = CSV_HEADERS.join(',')

  const rows = entries.map((entry) =>
    [
      formatInTimeZone(entry.occurredAt, timezone, 'yyyy-MM-dd HH:mm'),
      entry.type,
      entry.direction,
      entry.customerName ?? '',
      entry.customerPhone ?? '',
      entry.serviceName ?? '',
      entry.bookingId ?? '',
      entry.paymentId ?? '',
      String(entry.amount),
      entry.currency || 'CLP',
      entry.paymentMethod ?? '',
      entry.provider ?? '',
      entry.paymentStatus ?? '',
      entry.description ?? '',
    ]
      .map(escapeCSVField)
      .join(',')
  )

  return '\uFEFF' + [headerLine, ...rows].join('\n')
}


