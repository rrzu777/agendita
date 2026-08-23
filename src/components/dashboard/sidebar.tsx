'use client'

import { useEffect, useRef, useState, type FormEvent } from 'react'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import { signOut } from '@/lib/auth/actions'
import { GuardedLink, useUnsavedChanges } from '@/components/dashboard/unsaved-changes-provider'
import type { User } from '@supabase/supabase-js'
import type { Business, BusinessRole } from '@prisma/client'
import {
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-react'
import { useVocabulary } from '@/components/vocabulary-provider'
import { getDashboardNavItems, isDashboardNavItemActive } from '@/lib/dashboard/navigation'
import { MobileMoreMenu } from '@/components/dashboard/mobile-more-menu'
import { TourHelpMenu } from '@/components/dashboard/tours/tour-help-menu'

const COLLAPSE_KEY = 'agendita:sidebar-collapsed'

interface DashboardSidebarProps {
  user: User
  business: Business | null
  role: BusinessRole
}

export function DashboardSidebar({ user, business, role }: DashboardSidebarProps) {
  const v = useVocabulary()
  const navItems = getDashboardNavItems(v, role)
  const pathname = usePathname()
  const userName = user.user_metadata?.name || user.email?.split('@')[0] || 'Usuario'
  const mobileItems = navItems.filter((item) => item.mobile === 'primary')
  const mobileMoreItems = navItems.filter((item) => item.mobile === 'more')
  const { hasUnsavedChanges, requestNavigation } = useUnsavedChanges()
  const allowSignOut = useRef(false)

  // Colapsado por defecto en tablet (md–lg) para dar aire al contenido; en
  // pantallas grandes arranca expandido. El usuario puede alternar y se recuerda.
  const [collapsed, setCollapsed] = useState(false)

  useEffect(() => {
    // Sincroniza el estado inicial desde un sistema externo (localStorage / media
    // query) tras montar, para no provocar hydration mismatch (SSR no tiene window).
    const stored = window.localStorage.getItem(COLLAPSE_KEY)
    const initial = stored !== null ? stored === '1' : window.matchMedia('(max-width: 1023px)').matches
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time sync from localStorage on mount
    setCollapsed(initial)
  }, [])

  function toggle() {
    setCollapsed((prev) => {
      const next = !prev
      window.localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0')
      return next
    })
  }

  function handleSignOut(event: FormEvent<HTMLFormElement>) {
    if (!hasUnsavedChanges || allowSignOut.current) return

    event.preventDefault()
    const form = event.currentTarget
    const submitter = (event.nativeEvent as SubmitEvent).submitter
    requestNavigation(() => {
      allowSignOut.current = true
      form.requestSubmit()
    }, submitter instanceof HTMLElement ? submitter : null)
  }

  return (
    <>
      <aside
        className={cn(
          'sticky top-0 h-screen min-h-0 hidden shrink-0 flex-col border-r border-border/50 bg-sidebar transition-[width] duration-200 md:flex',
          collapsed ? 'w-20' : 'w-72',
        )}
      >
        <div className={cn('flex items-center gap-2 p-4', collapsed ? 'justify-center' : 'justify-between px-6 pt-6')}>
          {!collapsed && (
            <div className="min-w-0">
              <GuardedLink href="/" className="font-heading text-2xl font-semibold tracking-tight text-primary">
                Agendita
              </GuardedLink>
              {business && (
                <p className="mt-1 truncate text-sm font-semibold text-sidebar-foreground">{business.name}</p>
              )}
            </div>
          )}
          <button
            type="button"
            onClick={toggle}
            aria-label={collapsed ? 'Mostrar menú' : 'Ocultar menú'}
            title={collapsed ? 'Mostrar menú' : 'Ocultar menú'}
            className="flex size-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          >
            {collapsed ? <PanelLeftOpen className="size-5" /> : <PanelLeftClose className="size-5" />}
          </button>
        </div>

        <nav
          data-tour-id="nav-desktop"
          tabIndex={-1}
          className={cn('min-h-0 flex-1 overflow-y-auto', collapsed ? 'px-2' : 'px-4')}
        >
          <ul className="space-y-1">
            {navItems.map((item) => {
              const Icon = item.icon
              const isActive = isDashboardNavItemActive(item, pathname)

              const linkClassName = cn(
                'flex items-center rounded-lg text-sm font-semibold transition-colors',
                collapsed ? 'justify-center px-0 py-3' : 'gap-3 px-4 py-3',
                isActive
                  ? 'bg-primary text-primary-foreground shadow-[0_10px_22px_rgba(51,41,32,0.14)]'
                  : 'text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
              )
              const linkContent = (
                <>
                  <Icon className="size-5 shrink-0" />
                  {!collapsed && item.label}
                </>
              )

              return (
                <li key={item.href}>
                  {item.href === '/dashboard/settings' ? (
                    <GuardedLink
                      data-tour-id="payments-settings"
                      href={item.href}
                      title={collapsed ? item.label : undefined}
                      className={linkClassName}
                    >
                      {linkContent}
                    </GuardedLink>
                  ) : (
                    <GuardedLink
                      href={item.href}
                      title={collapsed ? item.label : undefined}
                      className={linkClassName}
                    >
                      {linkContent}
                    </GuardedLink>
                  )}
                </li>
              )
            })}
          </ul>
        </nav>

        <div className={cn('border-t border-border/50', collapsed ? 'p-2' : 'p-4')}>
          <TourHelpMenu className={collapsed ? 'mb-2' : 'mb-3'} compact={collapsed} />
          {!collapsed && (
            <div className="mb-3 rounded-xl bg-card p-4 ring-1 ring-border/60">
              <p className="truncate text-sm font-semibold text-primary">{userName}</p>
              <p className="truncate text-xs text-muted-foreground">{user.email}</p>
            </div>
          )}
          <form action={signOut} onSubmit={handleSignOut}>
            <button
              type="submit"
              title={collapsed ? 'Cerrar sesión' : undefined}
              className={cn(
                'flex w-full items-center rounded-lg text-sm font-semibold text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
                collapsed ? 'justify-center px-0 py-3' : 'gap-3 px-4 py-3 text-left',
              )}
            >
              <LogOut className="size-5 shrink-0" />
              {!collapsed && 'Cerrar sesión'}
            </button>
          </form>
        </div>
      </aside>

      <div className="fixed inset-x-0 bottom-0 z-50 border-t border-border/60 bg-card/95 px-3 py-2 backdrop-blur md:hidden">
        <nav aria-label="Navegación principal del dashboard" className="mx-auto grid max-w-md grid-cols-4 gap-1">
          {mobileItems.map((item) => {
            const Icon = item.icon
            const isActive = isDashboardNavItemActive(item, pathname)

            return (
              <GuardedLink
                key={item.href}
                href={item.href}
                aria-current={isActive ? 'page' : undefined}
                className={cn(
                  'flex flex-col items-center justify-center gap-1 rounded-lg px-2 py-2 text-[11px] font-semibold transition-colors',
                  isActive ? 'bg-primary text-primary-foreground' : 'text-muted-foreground',
                )}
              >
                <Icon className="size-5" />
                <span>{item.label}</span>
              </GuardedLink>
            )
          })}
          <MobileMoreMenu items={mobileMoreItems} pathname={pathname} onSignOut={handleSignOut} />
        </nav>
      </div>
    </>
  )
}
