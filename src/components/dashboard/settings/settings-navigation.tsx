'use client'

import { usePathname } from 'next/navigation'
import { GuardedLink } from '@/components/dashboard/unsaved-changes-provider'
import { SETTINGS_SECTIONS } from '@/lib/business/settings-navigation'
import { cn } from '@/lib/utils'

export function SettingsNavigation() {
  const pathname = usePathname()
  const currentSection = SETTINGS_SECTIONS.find((section) => section.href === pathname)?.key

  return (
    <nav aria-label="Secciones de configuración" data-tour-id="settings-navigation" className="overflow-x-auto border-b border-border/60 lg:overflow-visible lg:border-b-0">
      <ul className="flex min-w-max gap-1 px-1 lg:min-w-0 lg:flex-col lg:gap-0 lg:px-0">
        {SETTINGS_SECTIONS.map((section) => {
          const isCurrent = section.key === currentSection

          return (
            <li key={section.key}>
              <GuardedLink
                href={section.href}
                prefetch={section.prefetch}
                aria-current={isCurrent ? 'page' : undefined}
                className={cn(
                  'flex min-h-11 items-center border-b-2 px-3 text-sm font-medium whitespace-nowrap transition-colors motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 lg:w-full lg:border-b-0 lg:border-l-2 lg:px-4',
                  isCurrent
                    ? 'border-primary text-primary'
                    : 'border-transparent text-muted-foreground hover:border-border hover:text-foreground',
                )}
              >
                {section.label}
              </GuardedLink>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
