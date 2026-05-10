export function exportLedgerToCSV(entries: any[]): string {
  const headers = ['Fecha', 'Tipo', 'Dirección', 'Monto', 'Moneda', 'Descripción', 'Reserva']
  
  const rows = entries.map(entry => [
    new Date(entry.occurredAt).toISOString(),
    entry.type,
    entry.direction,
    entry.amount,
    entry.currency,
    entry.description || '',
    entry.bookingId || '',
  ])
  
  return [headers, ...rows]
    .map(row => row.join(','))
    .join('\n')
}

export function downloadCSV(content: string, filename: string) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' })
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = filename
  link.click()
  URL.revokeObjectURL(link.href)
}
