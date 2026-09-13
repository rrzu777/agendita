import type { ReactNode } from 'react'
import { ArrowLeft } from 'lucide-react'
import { GuardedLink } from './unsaved-changes-provider'
import { cn } from '@/lib/utils'

export type DashboardPageHeaderProps = {
  title: string
  subtitle?: string
  action?: ReactNode
  back?: { href: string; label: string }
  className?: string
}

export function DashboardPageHeader({ title, subtitle, action, back, className }: DashboardPageHeaderProps) {
  return (
    <header className={cn('border-b border-border bg-background px-4 py-6 min-[1100px]:px-10', className)}>
      <div className="mx-auto max-w-[1420px]">
        {back && <GuardedLink href={back.href} className="mb-2 inline-flex min-h-11 items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground"><ArrowLeft aria-hidden="true" className="size-4" />{back.label}</GuardedLink>}
        <div className="flex flex-col gap-4 min-[721px]:flex-row min-[721px]:items-center min-[721px]:justify-between">
          <div className="min-w-0">
            <h1 tabIndex={-1} className="break-words font-heading text-2xl font-semibold tracking-tight text-foreground outline-none md:text-3xl">{title}</h1>
            {subtitle && <p className="mt-2 max-w-prose text-sm text-muted-foreground">{subtitle}</p>}
          </div>
          {action && <div className="flex shrink-0 flex-wrap items-center gap-2 [&_[data-slot=button]]:min-h-11">{action}</div>}
        </div>
      </div>
    </header>
  )
}
