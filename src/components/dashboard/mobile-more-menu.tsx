'use client'

import { useState, type FormEvent } from 'react'
import { flushSync } from 'react-dom'
import { LogOut, MoreHorizontal } from 'lucide-react'
import { GuardedLink } from '@/components/dashboard/unsaved-changes-provider'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import { cn } from '@/lib/utils'
import { isDashboardNavItemActive, type DashboardNavItem } from '@/lib/dashboard/navigation'
import { signOut } from '@/lib/auth/actions'
import { TourHelpMenu } from '@/components/dashboard/tours/tour-help-menu'

type MobileMoreMenuProps = {
  items: DashboardNavItem[]
  pathname: string
  onSignOut: (event: FormEvent<HTMLFormElement>) => void
}

export function MobileMoreMenu({ items, pathname, onSignOut }: MobileMoreMenuProps) {
  const [open, setOpen] = useState(false)
  const closeForTour = () => {
    flushSync(() => setOpen(false))
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <button
          type="button"
          aria-label="Más opciones"
          data-tour-id="nav-mobile-more"
          className="flex flex-col items-center justify-center gap-1 rounded-lg px-2 py-2 text-[11px] font-semibold text-muted-foreground"
        >
          <MoreHorizontal className="size-5" />
          <span>Más</span>
        </button>
      </SheetTrigger>
      <SheetContent side="bottom" className="max-h-[85dvh] rounded-t-2xl pb-[env(safe-area-inset-bottom)]">
        <SheetHeader>
          <SheetTitle>Más opciones</SheetTitle>
          <SheetDescription>Administra las demás áreas de tu negocio.</SheetDescription>
        </SheetHeader>
        <nav aria-label="Más secciones del dashboard" className="min-h-0 overflow-y-auto px-4 pb-4">
          <ul className="space-y-1">
            {items.map((item) => {
              const Icon = item.icon
              const isActive = isDashboardNavItemActive(item, pathname)

              return (
                <li key={item.href}>
                  <GuardedLink
                    href={item.href}
                    aria-current={isActive ? 'page' : undefined}
                    onAcceptedNavigation={() => setOpen(false)}
                    className={cn(
                      'flex items-center gap-3 rounded-lg px-4 py-3 text-sm font-semibold transition-colors',
                      isActive
                        ? 'bg-primary text-primary-foreground'
                        : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                    )}
                  >
                    <Icon className="size-5 shrink-0" />
                    {item.label}
                  </GuardedLink>
                </li>
              )
            })}
          </ul>
          <TourHelpMenu className="mt-3 border-t border-border pt-3" onAcceptedStart={closeForTour} />
          <form action={signOut} onSubmit={onSignOut} className="mt-3 border-t border-border pt-3">
            <button
              type="submit"
              className="flex w-full items-center gap-3 rounded-lg px-4 py-3 text-left text-sm font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <LogOut className="size-5 shrink-0" />
              Cerrar sesión
            </button>
          </form>
        </nav>
      </SheetContent>
    </Sheet>
  )
}
