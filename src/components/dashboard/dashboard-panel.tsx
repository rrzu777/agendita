import { useId, type ComponentProps, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

type DashboardPanelProps = Omit<ComponentProps<'section'>, 'title'> & {
  title: string
  description?: ReactNode
  action?: ReactNode
  tone?: 'default' | 'attention' | 'insight'
}

export function DashboardPanel({ title, description, action, tone = 'default', children, className, ...props }: DashboardPanelProps) {
  const headingId = useId()
  return (
    <section aria-labelledby={headingId} className={cn(
      'min-w-0 rounded-xl border p-4 md:p-6 [&_[data-slot=button]]:min-h-11',
      tone === 'default' && 'border-border bg-card text-card-foreground',
      tone === 'attention' && 'border-warning/30 bg-warning/5 text-foreground',
      tone === 'insight' && 'border-foreground bg-foreground text-background',
      className,
    )} {...props}>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id={headingId} className="font-heading text-lg font-semibold tracking-tight">{title}</h2>
          {description && <p className={cn('mt-1 text-sm', tone === 'insight' ? 'text-background/80' : 'text-muted-foreground')}>{description}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  )
}
