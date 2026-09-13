'use client'

import { useEffect, useRef, useState, type FormEvent } from 'react'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import { signOut } from '@/lib/auth/actions'
import { GuardedLink, useUnsavedChanges } from '@/components/dashboard/unsaved-changes-provider'
import type { User } from '@supabase/supabase-js'
import type { Business, BusinessRole } from '@prisma/client'
import {
  ChevronDown,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-react'
import { useVocabulary } from '@/components/vocabulary-provider'
import { getDashboardNavGroups, isDashboardNavGroupActive, isDashboardNavItemActive } from '@/lib/dashboard/navigation'
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
  const navGroups = getDashboardNavGroups(v, role)
  const pathname = usePathname()
  const userName = user.user_metadata?.name || user.email?.split('@')[0] || 'Usuario'
  const mobileGroups = navGroups.filter((group) => group.mobile === 'primary')
  const mobileMoreGroups = navGroups.filter((group) => group.mobile === 'more')
  const { hasUnsavedChanges, requestNavigation } = useUnsavedChanges()
  const allowSignOut = useRef(false)

  // Colapsado por defecto en tablet (md–lg) para dar aire al contenido; en
  // pantallas grandes arranca expandido. El usuario puede alternar y se recuerda.
  const [collapsed, setCollapsed] = useState(false)
  const [openGroups, setOpenGroups] = useState<Set<string>>(
    () => new Set(navGroups.filter((group) => group.items.length > 1).map((group) => group.key)),
  )

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

  function toggleGroup(key: string) {
    setOpenGroups((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
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
          collapsed ? 'w-[5.125rem]' : 'w-[15.5rem]',
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
            className="flex size-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          >
            {collapsed ? <PanelLeftOpen className="size-5" /> : <PanelLeftClose className="size-5" />}
          </button>
        </div>

        <nav
          data-tour-id="nav-desktop"
          tabIndex={-1}
          className={cn('min-h-0 flex-1 overflow-y-auto', collapsed ? 'px-2' : 'px-4')}
        >
          <ul className="space-y-1.5">
            {navGroups.map((group) => {
              const Icon = group.icon
              const isActive = isDashboardNavGroupActive(group, pathname)
              const hasChildren = group.items.length > 1
              const isOpen = openGroups.has(group.key) || isActive

              return (
                <li key={group.key}>
                  {!hasChildren ? (
                    <GuardedLink
                      href={group.href}
                      aria-current={isActive ? 'page' : undefined}
                      title={collapsed ? group.label : undefined}
                      className={cn(
                        'flex items-center rounded-lg text-sm font-semibold transition-colors',
                        collapsed ? 'justify-center px-0 py-3' : 'gap-3 px-4 py-3',
                        isActive
                          ? 'bg-sidebar-primary text-sidebar-primary-foreground'
                          : 'text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
                      )}
                    >
                      <Icon className="size-5 shrink-0" aria-hidden="true" />
                      {!collapsed && group.label}
                    </GuardedLink>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => toggleGroup(group.key)}
                        data-tour-id={group.key === 'settings' ? 'payments-settings' : undefined}
                        aria-expanded={isOpen}
                        aria-label={collapsed ? group.label : undefined}
                        title={collapsed ? group.label : undefined}
                        className={cn(
                          'flex min-h-11 w-full items-center rounded-lg py-2 text-left text-sm font-semibold transition-colors',
                          collapsed ? 'justify-center px-0' : 'gap-3 px-4',
                          isActive ? 'text-sidebar-primary' : 'text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
                        )}
                      >
                        <Icon className="size-5 shrink-0" aria-hidden="true" />
                        {!collapsed && <span className="min-w-0 flex-1">{group.label}</span>}
                        {!collapsed && <ChevronDown className={cn('size-4 transition-transform', isOpen && 'rotate-180')} aria-hidden="true" />}
                      </button>
                      {isOpen && (
                        <ul className={cn(
                          'mt-1 space-y-0.5',
                          collapsed ? '' : 'ml-6 border-l border-sidebar-border pl-3',
                        )}>
                          {group.items.map((item) => {
                            const ItemIcon = item.icon
                            const itemActive = isDashboardNavItemActive(item, pathname)
                            return (
                              <li key={item.href}>
                                <GuardedLink
                                  href={item.href}
                                  aria-current={itemActive ? 'page' : undefined}
                                  title={collapsed ? item.label : undefined}
                                  className={cn(
                                    'flex min-h-11 items-center rounded-lg px-3 py-2 text-sm transition-colors',
                                    collapsed && 'justify-center px-0',
                                    itemActive
                                      ? 'bg-sidebar-accent font-semibold text-sidebar-accent-foreground'
                                      : 'text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
                                  )}
                                >
                                  {collapsed ? <ItemIcon className="size-4" aria-hidden="true" /> : item.label}
                                </GuardedLink>
                              </li>
                            )
                          })}
                        </ul>
                      )}
                    </>
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
          <form noValidate action={signOut} onSubmit={handleSignOut}>
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

      <div className="fixed inset-x-0 bottom-0 z-50 border-t border-border/60 bg-card/95 px-3 pt-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))] backdrop-blur md:hidden">
        <nav aria-label="Navegación principal del dashboard" className="mx-auto grid max-w-md grid-cols-4 gap-1">
          {mobileGroups.map((group) => {
            const Icon = group.icon
            const isActive = isDashboardNavGroupActive(group, pathname)

            return (
              <GuardedLink
                key={group.key}
                href={group.href}
                aria-current={isActive ? 'page' : undefined}
                className={cn(
                  'flex flex-col items-center justify-center gap-1 rounded-lg px-2 py-2 text-[11px] font-semibold transition-colors',
                  isActive ? 'bg-primary text-primary-foreground' : 'text-muted-foreground',
                )}
              >
                <Icon className="size-5" />
                <span>{group.label}</span>
              </GuardedLink>
            )
          })}
          <MobileMoreMenu groups={mobileMoreGroups} pathname={pathname} onSignOut={handleSignOut} />
        </nav>
      </div>
    </>
  )
}
