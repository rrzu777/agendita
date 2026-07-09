'use client'

import { useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { TruncatedCell } from '@/components/ui/truncated-cell'
import { StatusBadge } from '@/components/ui/status-badge'
import { TableMobileCard } from '@/components/ui/table-mobile-card'
import { TABLE_COL, TABLE_MIN_WIDTH } from '@/components/ui/table-widths'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Receipt, Download } from 'lucide-react'
import { getPromotionRedemptions } from '@/server/actions/promotions'
import { formatMoney } from '@/lib/money'

type Redemption = Awaited<ReturnType<typeof getPromotionRedemptions>>[number]

const statusLabels: Record<string, string> = {
  applied: 'Aplicado',
  released: 'Liberado',
}

const sourceLabels: Record<string, string> = {
  public_booking: 'Reserva online',
  dashboard_booking: 'Reserva manual',
  system: 'Sistema',
}

function formatDateTime(value: Date | string | null) {
  if (!value) return '—'
  return new Date(value).toLocaleString('es-CL', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

// Escapa un campo CSV. El CSV lo abre el comerciante en Excel/Sheets, así que
// primero neutralizamos inyección de fórmulas: un nombre de clienta como
// =HYPERLINK(...) o @cmd se interpretaría como fórmula viva. Si el campo empieza
// con = + - @ (o tab/CR), lo prefijamos con ' para forzar texto. Luego aplicamos
// el escape estándar (comillas duplicadas + envoltura por coma/comilla/salto).
function csvField(value: unknown): string {
  let s = value == null ? '' : String(value)
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s
  if (/[",\n\r]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"'
  return s
}

export function RedemptionsButton({
  promotionId,
  promotionName,
  currency,
  open: controlledOpen,
  onOpenChange,
  hideTrigger = false,
}: {
  promotionId: string
  promotionName: string
  currency: string
  open?: boolean
  onOpenChange?: (open: boolean) => void
  hideTrigger?: boolean
}) {
  const [internalOpen, setInternalOpen] = useState(false)
  const isControlled = controlledOpen !== undefined
  const open = isControlled ? controlledOpen : internalOpen
  const setOpen = (next: boolean) => {
    if (isControlled) onOpenChange?.(next)
    else setInternalOpen(next)
  }
  const [isPending, startTransition] = useTransition()
  const [rows, setRows] = useState<Redemption[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  function handleOpenChange(next: boolean) {
    setOpen(next)
    if (next && rows === null) {
      setError(null)
      startTransition(async () => {
        try {
          const data = await getPromotionRedemptions(promotionId)
          setRows(data)
        } catch (e) {
          setError(e instanceof Error ? e.message : 'No se pudieron cargar los canjes')
        }
      })
    }
  }

  function handleExport() {
    if (!rows || rows.length === 0) return
    const header = ['Clienta', 'Reserva', 'Descuento', 'Fecha', 'Origen', 'Estado']
    const lines = [header.map(csvField).join(',')]
    for (const r of rows) {
      lines.push(
        [
          csvField(r.customer?.name ?? ''),
          csvField(formatDateTime(r.booking?.startDateTime ?? null)),
          csvField(formatMoney(r.discountAmount, currency)),
          csvField(formatDateTime(r.createdAt)),
          csvField(sourceLabels[r.source] ?? r.source),
          csvField(statusLabels[r.status] ?? r.status),
        ].join(','),
      )
    }
    // BOM UTF-8 para que Excel lea acentos correctamente.
    const csv = '﻿' + lines.join('\r\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `canjes-${promotionName.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.csv`
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      {!hideTrigger && (
        <DialogTrigger asChild>
          <Button type="button" size="sm" variant="ghost">
            <Receipt className="mr-1 size-4" />
            Ver canjes
          </Button>
        </DialogTrigger>
      )}
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="font-heading text-2xl font-semibold tracking-tight text-primary">
            Canjes — {promotionName}
          </DialogTitle>
        </DialogHeader>

        <div className="mb-4 flex justify-end">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={handleExport}
            disabled={!rows || rows.length === 0}
          >
            <Download className="mr-1 size-4" />
            Exportar CSV
          </Button>
        </div>

        {error ? (
          <p className="py-8 text-center text-sm text-destructive">{error}</p>
        ) : isPending && rows === null ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Cargando canjes…</p>
        ) : rows && rows.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Aún no hay canjes de esta promoción.</p>
        ) : (
          <>
            {/* Mobile: cards */}
            <div className="space-y-3 lg:hidden">
              {rows?.map((r) => (
                <TableMobileCard
                  key={r.id}
                  title={r.customer?.name || '—'}
                  subtitle={formatDateTime(r.booking?.startDateTime ?? null)}
                  badge={<StatusBadge map="redemption" status={r.status} />}
                  rows={[
                    { label: 'Descuento', value: formatMoney(r.discountAmount, currency) },
                    { label: 'Fecha', value: formatDateTime(r.createdAt) },
                    { label: 'Origen', value: sourceLabels[r.source] ?? r.source },
                  ]}
                />
              ))}
            </div>

            {/* Desktop: table */}
            <div className="hidden lg:block studio-card overflow-hidden">
              <Table fixed className={TABLE_MIN_WIDTH}>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead>Clienta</TableHead>
                    <TableHead className={TABLE_COL.date}>Reserva</TableHead>
                    <TableHead className={TABLE_COL.money}>Descuento</TableHead>
                    <TableHead className={TABLE_COL.date}>Fecha</TableHead>
                    <TableHead className={TABLE_COL.label}>Origen</TableHead>
                    <TableHead className={TABLE_COL.status}>Estado</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows?.map((r) => (
                    <TableRow key={r.id}>
                      <TruncatedCell className="font-semibold text-primary" primary={r.customer?.name || '—'} />
                      <TableCell className={`${TABLE_COL.date} text-sm`}>
                        {formatDateTime(r.booking?.startDateTime ?? null)}
                      </TableCell>
                      <TableCell className={`${TABLE_COL.money} whitespace-normal`}>
                        {formatMoney(r.discountAmount, currency)}
                      </TableCell>
                      <TableCell className={`${TABLE_COL.date} text-sm`}>{formatDateTime(r.createdAt)}</TableCell>
                      <TableCell className={`${TABLE_COL.label} text-sm`}>
                        {sourceLabels[r.source] ?? r.source}
                      </TableCell>
                      <TableCell className={TABLE_COL.status}>
                        <StatusBadge map="redemption" status={r.status} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
