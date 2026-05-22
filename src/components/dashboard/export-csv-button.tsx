'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Download } from 'lucide-react'

function getCurrentMonthRange(): { from: string; to: string } {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const lastDay = String(new Date(year, now.getMonth() + 1, 0).getDate()).padStart(2, '0')
  return {
    from: `${year}-${month}-01`,
    to: `${year}-${month}-${lastDay}`,
  }
}

export function ExportCSVButton() {
  const defaultRange = getCurrentMonthRange()
  const [from, setFrom] = useState(defaultRange.from)
  const [to, setTo] = useState(defaultRange.to)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleExport() {
    setError(null)

    if (!from || !to) {
      setError('Selecciona ambas fechas')
      return
    }

    if (from > to) {
      setError('La fecha "desde" debe ser menor o igual a "hasta"')
      return
    }

    setLoading(true)

    try {
      const response = await fetch(
        `/api/dashboard/ledger/export?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
      )

      if (!response.ok) {
        const body = await response.json().catch(() => null)
        setError(body?.error || `Error ${response.status}`)
        setLoading(false)
        return
      }

      const blob = await response.blob()
      const contentDisposition = response.headers.get('Content-Disposition')
      const filenameMatch = contentDisposition?.match(/filename="(.+)"/)
      const filename = filenameMatch?.[1] || 'export.csv'

      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = filename
      link.click()
      URL.revokeObjectURL(url)

      setError(null)
    } catch {
      setError('Error de conexión al exportar')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-muted-foreground">Desde</label>
        <input
          type="date"
          value={from}
          onChange={(e) => {
            setFrom(e.target.value)
            setError(null)
          }}
          max={to || undefined}
          className="h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
        />
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-muted-foreground">Hasta</label>
        <input
          type="date"
          value={to}
          onChange={(e) => {
            setTo(e.target.value)
            setError(null)
          }}
          min={from || undefined}
          className="h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
        />
      </div>
      <Button
        onClick={handleExport}
        disabled={loading}
        variant="outline"
        className="h-9"
      >
        <Download className="mr-2 size-4" />
        {loading ? 'Exportando...' : 'Exportar CSV'}
      </Button>
      {error && (
        <p className="w-full text-sm text-destructive">{error}</p>
      )}
    </div>
  )
}
