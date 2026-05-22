import { describe, it, expect } from 'vitest'
import { buildLedgerCSV } from '@/lib/finance/csv-export'
import type { LedgerCSVEntry } from '@/lib/finance/csv-export'

const baseEntry: LedgerCSVEntry = {
  occurredAt: new Date('2026-05-15T14:00:00Z'),
  type: 'deposit_paid',
  direction: 'income',
  customerName: 'Juan Pérez',
  customerPhone: '+56912345678',
  serviceName: 'Corte de pelo',
  bookingId: 'booking-1',
  paymentId: 'payment-1',
  amount: 15000,
  currency: 'CLP',
  paymentMethod: 'Efectivo',
  provider: 'manual',
  paymentStatus: 'approved',
  description: 'Abono inicial',
}

function stripBOM(csv: string): string {
  return csv.charCodeAt(0) === 0xfeff ? csv.slice(1) : csv
}

function parseCSV(csv: string): string[][] {
  const clean = stripBOM(csv)
  const result: string[][] = []
  let row: string[] = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i]
    if (inQuotes) {
      if (ch === '"') {
        if (clean[i + 1] === '"') {
          current += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        current += ch
      }
    } else {
      if (ch === '"') {
        inQuotes = true
      } else if (ch === ',') {
        row.push(current)
        current = ''
      } else if (ch === '\n') {
        row.push(current)
        current = ''
        result.push(row)
        row = []
      } else if (ch === '\r') {
        continue
      } else {
        current += ch
      }
    }
  }
  row.push(current)
  if (row.length > 0 && row.some((c) => c !== '')) {
    result.push(row)
  }
  return result
}

describe('buildLedgerCSV', () => {
  const timezone = 'America/Santiago'

  it('produces exact 14 headers', () => {
    const csv = buildLedgerCSV([], timezone)
    const parsed = parseCSV(csv)
    expect(parsed[0]).toHaveLength(14)
    expect(parsed[0]).toEqual([
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
    ])
  })

  it('prepends UTF-8 BOM', () => {
    const csv = buildLedgerCSV([], timezone)
    expect(csv.charCodeAt(0)).toBe(0xfeff)
  })

  it('formats occurredAt in business timezone as YYYY-MM-DD HH:mm', () => {
    const entry: LedgerCSVEntry = {
      ...baseEntry,
      occurredAt: new Date('2026-01-15T14:00:00Z'),
    }
    const csv = buildLedgerCSV([entry], timezone)
    const parsed = parseCSV(csv)
    expect(parsed[1][0]).toBe('2026-01-15 11:00')
  })

  it('outputs amount as integer without formatting', () => {
    const entry: LedgerCSVEntry = { ...baseEntry, amount: 15000 }
    const csv = buildLedgerCSV([entry], timezone)
    const parsed = parseCSV(csv)
    expect(parsed[1][8]).toBe('15000')
  })

  it('defaults currency to CLP when empty', () => {
    const entry: LedgerCSVEntry = { ...baseEntry, currency: null }
    const csv = buildLedgerCSV([entry], timezone)
    const parsed = parseCSV(csv)
    expect(parsed[1][9]).toBe('CLP')
  })

  it('leaves fields empty when data is missing', () => {
    const entry: LedgerCSVEntry = {
      ...baseEntry,
      customerName: null,
      customerPhone: null,
      serviceName: null,
      bookingId: null,
      paymentId: null,
      paymentMethod: null,
      provider: null,
      paymentStatus: null,
      description: null,
    }
    const csv = buildLedgerCSV([entry], timezone)
    const parsed = parseCSV(csv)
    expect(parsed[1][3]).toBe('')
    expect(parsed[1][4]).toBe('')
    expect(parsed[1][5]).toBe('')
    expect(parsed[1][6]).toBe('')
    expect(parsed[1][7]).toBe('')
    expect(parsed[1][10]).toBe('')
    expect(parsed[1][11]).toBe('')
    expect(parsed[1][12]).toBe('')
    expect(parsed[1][13]).toBe('')
  })

  it('escapes commas in fields by wrapping in quotes', () => {
    const entry: LedgerCSVEntry = {
      ...baseEntry,
      description: 'Pago parcial, incluye propina',
    }
    const csv = buildLedgerCSV([entry], timezone)
    const parsed = parseCSV(csv)
    expect(parsed[1][13]).toBe('Pago parcial, incluye propina')
    expect(csv).toContain('"Pago parcial, incluye propina"')
  })

  it('escapes double quotes by doubling them', () => {
    const entry: LedgerCSVEntry = {
      ...baseEntry,
      customerName: 'Juan "El Rápido" Pérez',
    }
    const csv = buildLedgerCSV([entry], timezone)
    const parsed = parseCSV(csv)
    expect(parsed[1][3]).toBe('Juan "El Rápido" Pérez')
    expect(csv).toContain('"Juan ""El Rápido"" Pérez"')
  })

  it('escapes newlines in fields by wrapping in quotes', () => {
    const entry: LedgerCSVEntry = {
      ...baseEntry,
      description: 'Línea 1\nLínea 2',
    }
    const csv = buildLedgerCSV([entry], timezone)
    const parsed = parseCSV(csv)
    expect(parsed[1][13]).toBe('Línea 1\nLínea 2')
  })

  it('protects against CSV injection with = prefix', () => {
    const entry: LedgerCSVEntry = {
      ...baseEntry,
      description: '=SUM(1,2)',
    }
    const csv = buildLedgerCSV([entry], timezone)
    const parsed = parseCSV(csv)
    expect(parsed[1][13]).toBe("'=SUM(1,2)")
  })

  it('protects against CSV injection with + prefix', () => {
    const entry: LedgerCSVEntry = {
      ...baseEntry,
      description: '+malicious',
    }
    const csv = buildLedgerCSV([entry], timezone)
    const parsed = parseCSV(csv)
    expect(parsed[1][13]).toBe("'+malicious")
  })

  it('protects against CSV injection with - prefix', () => {
    const entry: LedgerCSVEntry = {
      ...baseEntry,
      description: '-malicious',
    }
    const csv = buildLedgerCSV([entry], timezone)
    const parsed = parseCSV(csv)
    expect(parsed[1][13]).toBe("'-malicious")
  })

  it('protects against CSV injection with @ prefix', () => {
    const entry: LedgerCSVEntry = {
      ...baseEntry,
      description: '@malicious',
    }
    const csv = buildLedgerCSV([entry], timezone)
    const parsed = parseCSV(csv)
    expect(parsed[1][13]).toBe("'@malicious")
  })

  it('protects against CSV injection with tab prefix', () => {
    const entry: LedgerCSVEntry = {
      ...baseEntry,
      description: '\tmalicious',
    }
    const csv = buildLedgerCSV([entry], timezone)
    const parsed = parseCSV(csv)
    expect(parsed[1][13]).toBe("'\tmalicious")
  })

  it('protects against CSV injection after leading spaces', () => {
    const entry: LedgerCSVEntry = {
      ...baseEntry,
      description: '   =hidden',
    }
    const csv = buildLedgerCSV([entry], timezone)
    const parsed = parseCSV(csv)
    expect(parsed[1][13]).toBe("'   =hidden")
  })

  it('does not prefix normal text starting with safe chars', () => {
    const entry: LedgerCSVEntry = {
      ...baseEntry,
      description: 'Pago normal',
    }
    const csv = buildLedgerCSV([entry], timezone)
    const parsed = parseCSV(csv)
    expect(parsed[1][13]).toBe('Pago normal')
  })

  it('uses enum values for type and direction, not UI labels', () => {
    const entry: LedgerCSVEntry = {
      ...baseEntry,
      type: 'manual_income',
      direction: 'expense',
    }
    const csv = buildLedgerCSV([entry], timezone)
    const parsed = parseCSV(csv)
    expect(parsed[1][1]).toBe('manual_income')
    expect(parsed[1][2]).toBe('expense')
  })

  it('handles multiple entries in order', () => {
    const entries: LedgerCSVEntry[] = [
      { ...baseEntry, occurredAt: new Date('2026-05-10T14:00:00Z'), bookingId: 'b1' },
      { ...baseEntry, occurredAt: new Date('2026-05-15T14:00:00Z'), bookingId: 'b2' },
    ]
    const csv = buildLedgerCSV(entries, timezone)
    const parsed = parseCSV(csv)
    expect(parsed).toHaveLength(3)
    expect(parsed[1][6]).toBe('b1')
    expect(parsed[2][6]).toBe('b2')
  })
})
