'use client'

import { useRef, useState, type FormEvent } from 'react'
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
import { isDashboardNavGroupActive, isDashboardNavItemActive, type DashboardNavGroup } from '@/lib/dashboard/navigation'
import { signOut } from '@/lib/auth/actions'
import { TourHelpMenu } from '@/components/dashboard/tours/tour-help-menu'

type MobileMoreMenuProps = {
  groups: DashboardNavGroup[]
  pathname: string
  onSignOut: (event: FormEvent<HTMLFormElement>) => void
}

export function MobileMoreMenu({ groups, pathname, onSignOut }: MobileMoreMenuProps) {
  const [open, setOpen] = useState(false)
  const titleRef = useRef<HTMLHeadingElement>(null)
  const closeForTour = () => {
    setOpen(false)
    return new Promise<void>((resolve) => {
      const hasExited = () => (
        document.querySelector('[data-mobile-more-sheet]') === null
        && document.querySelector('[data-slot="sheet-overlay"]') === null
      )
      if (hasExited()) {
        resolve()
        return
      }
      const observer = new MutationObserver(() => {
        if (!hasExited()) return
        observer.disconnect()
        resolve()
      })
      observer.observe(document.body, { childList: true, subtree: true })
    })
  }

  return (
    <div data-tour-id="tour-help" tabIndex={-1} className="min-w-0">
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label="Más opciones"
            data-tour-id="nav-mobile-more"
            className={cn(
              'flex w-full flex-col items-center justify-center gap-1 rounded-lg px-2 py-2 text-[11px] font-semibold',
              groups.some((group) => isDashboardNavGroupActive(group, pathname))
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground',
            )}
          >
            <MoreHorizontal className="size-5" />
            <span>Más</span>
          </button>
        </SheetTrigger>
        <SheetContent data-mobile-more-sheet="" side="bottom" className="max-h-[85dvh] rounded-t-2xl pb-[env(safe-area-inset-bottom)]"
          onOpenAutoFocus={(event) => { event.preventDefault(); titleRef.current?.focus() }}
        >
          <SheetHeader>
            <SheetTitle ref={titleRef} tabIndex={-1}>Más opciones</SheetTitle>
            <SheetDescription>Administra las demás áreas de tu negocio.</SheetDescription>
          </SheetHeader>
          <nav aria-label="Más secciones del dashboard" className="min-h-0 overflow-y-auto px-4 pb-4">
            <ul className="space-y-5">
              {groups.map((group) => (
                <li key={group.key}>
                  <p className="px-2 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                    {group.label}
                  </p>
                  <ul className="mt-1 space-y-1">
                    {group.items.map((item) => {
                      const Icon = item.icon
                      const isActive = isDashboardNavItemActive(item, pathname)

                      return (
                        <li key={item.href}>
                          <GuardedLink
                            href={item.href}
                            aria-current={isActive ? 'page' : undefined}
                            onAcceptedNavigation={() => setOpen(false)}
                            className={cn(
                              'flex min-h-11 items-center gap-3 rounded-lg px-3 py-2 text-sm font-semibold transition-colors',
                              isActive
                                ? 'bg-primary text-primary-foreground'
                                : 'text-foreground hover:bg-muted',
                            )}
                          >
                            <Icon className="size-5 shrink-0" aria-hidden="true" />
                            {item.label}
                          </GuardedLink>
                        </li>
                      )
                    })}
                  </ul>
                </li>
              ))}
            </ul>
            <TourHelpMenu className="mt-3 border-t border-border pt-3" onAcceptedStart={closeForTour} />
            <form noValidate action={signOut} onSubmit={onSignOut} className="mt-3 border-t border-border pt-3">
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
    </div>
  )
}
