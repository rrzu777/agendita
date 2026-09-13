'use client'

import { usePathname } from 'next/navigation'
import { GuardedLink } from '@/components/dashboard/unsaved-changes-provider'
import { cn } from '@/lib/utils'

export type DashboardContextNavItem = {
  href: string
  label: string
}

type DashboardContextNavProps = {
  label: string
  items: DashboardContextNavItem[]
  className?: string
}

export function DashboardContextNav({ label, items, className }: DashboardContextNavProps) {
  const pathname = usePathname() ?? ''

  return (
    <nav aria-label={label} className={cn('overflow-x-auto', className)}>
      <ul className="flex min-w-max gap-1 border-b border-border">
        {items.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`)
          return (
            <li key={item.href}>
              <GuardedLink
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex min-h-11 items-center border-b-2 px-3 text-sm font-medium transition-colors',
                  active
                    ? 'border-primary text-primary'
                    : 'border-transparent text-muted-foreground hover:border-border hover:text-foreground',
                )}
              >
                {item.label}
              </GuardedLink>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
