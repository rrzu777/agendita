import type { ReactNode } from 'react'
import { SettingsNavigation } from '@/components/dashboard/settings/settings-navigation'

export function SettingsShell({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-clip p-5 md:p-10 lg:grid lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-10">
      <aside className="lg:sticky lg:top-8 lg:self-start lg:border-r lg:border-border/60 lg:pr-5">
        <SettingsNavigation />
      </aside>
      <div className="min-w-0 pt-6 lg:pt-0">{children}</div>
    </div>
  )
}
