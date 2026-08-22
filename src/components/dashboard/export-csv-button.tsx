'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { FormField } from '@/components/ui/form-field'
import { Input } from '@/components/ui/input'
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
    <fieldset className="flex flex-wrap items-end gap-3">
      <legend className="sr-only">Rango de fechas para exportar movimientos</legend>
      <FormField id="ledger-export-from" label="Desde">
        {(a11y) => (
          <Input
            {...a11y}
            id="ledger-export-from"
            type="date"
            density="compact"
            value={from}
            onChange={(e) => {
              setFrom(e.target.value)
              setError(null)
            }}
            max={to || undefined}
          />
        )}
      </FormField>
      <FormField id="ledger-export-to" label="Hasta">
        {(a11y) => (
          <Input
            {...a11y}
            id="ledger-export-to"
            type="date"
            density="compact"
            value={to}
            onChange={(e) => {
              setTo(e.target.value)
              setError(null)
            }}
            min={from || undefined}
          />
        )}
      </FormField>
      <Button
        onClick={handleExport}
        disabled={loading}
        variant="outline"
      >
        <Download className="mr-2 size-4" />
        {loading ? 'Exportando...' : 'Exportar CSV'}
      </Button>
      {error && (
        <p role="alert" className="w-full text-sm text-destructive">{error}</p>
      )}
    </fieldset>
  )
}
