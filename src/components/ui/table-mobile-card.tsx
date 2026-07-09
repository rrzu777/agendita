import * as React from 'react'
import { cn } from '@/lib/utils'

export type TableMobileRow = { label: React.ReactNode; value: React.ReactNode }

export function TableMobileCard({
  title,
  subtitle,
  badge,
  rows,
  actions,
  className,
}: {
  title: React.ReactNode
  subtitle?: React.ReactNode
  badge?: React.ReactNode
  rows: TableMobileRow[]
  actions?: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn('studio-card overflow-hidden p-4', className)}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate font-semibold text-primary">{title}</div>
          {subtitle != null && <div className="truncate text-xs text-muted-foreground">{subtitle}</div>}
        </div>
        {badge != null && <div className="shrink-0">{badge}</div>}
      </div>
      {rows.length > 0 && (
        <dl className="mt-3 space-y-1.5 text-sm">
          {rows.map((row, i) => (
            <div key={i} className="flex items-center justify-between gap-3">
              <dt className="text-muted-foreground">{row.label}</dt>
              <dd className="min-w-0 truncate text-right font-medium">{row.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {actions != null && <div className="mt-3 flex flex-wrap justify-end gap-2">{actions}</div>}
    </div>
  )
}
