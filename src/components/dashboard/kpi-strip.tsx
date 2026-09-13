import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export type KpiItem = {
  label: string
  value: ReactNode
  description: ReactNode
  tone?: 'default' | 'success' | 'warning' | 'danger'
}

export function KpiStrip({ label, items, className }: { label: string; items: KpiItem[]; className?: string }) {
  return (
    <dl aria-label={label} className={cn('grid grid-cols-2 gap-x-6 gap-y-5 border-y border-border py-5 min-[1100px]:flex min-[1100px]:flex-wrap', className)}>
      {items.map((item) => <div key={item.label} className="min-w-0 flex-1">
        <dt className="text-sm font-medium text-muted-foreground">{item.label}</dt>
        <dd className="mt-1">
          <span className={cn('block break-words text-2xl font-semibold tabular-nums tracking-tight', {
            'text-foreground': !item.tone || item.tone === 'default',
            'text-success': item.tone === 'success',
            'text-warning': item.tone === 'warning',
            'text-destructive': item.tone === 'danger',
          })}>{item.value ?? 'No disponible'}</span>
          <span className="mt-1 block text-xs text-muted-foreground">{item.description}</span>
        </dd>
      </div>)}
    </dl>
  )
}
