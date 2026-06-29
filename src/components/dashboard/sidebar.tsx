'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import { signOut } from '@/lib/auth/actions'
import type { User } from '@supabase/supabase-js'
import type { Business } from '@prisma/client'
import {
  CalendarDays,
  Clock3,
  CreditCard,
  LayoutDashboard,
  LogOut,
  MessageSquareText,
  PanelLeftClose,
  PanelLeftOpen,
  ReceiptText,
  Scissors,
  Settings,
  Star,
  Ticket,
  Users,
} from 'lucide-react'

const navItems = [
  { href: '/dashboard', label: 'Resumen', icon: LayoutDashboard },
  { href: '/dashboard/bookings', label: 'Reservas', icon: MessageSquareText },
  { href: '/dashboard/calendar', label: 'Calendario', icon: CalendarDays },
  { href: '/dashboard/services', label: 'Servicios', icon: Scissors },
  { href: '/dashboard/availability', label: 'Horarios', icon: Clock3 },
  { href: '/dashboard/customers', label: 'Clientes', icon: Users },
  { href: '/dashboard/payments', label: 'Pagos', icon: CreditCard },
  { href: '/dashboard/promociones', label: 'Promociones', icon: Ticket },
  { href: '/dashboard/billing', label: 'Facturación', icon: ReceiptText },
  { href: '/dashboard/reviews', label: 'Reseñas', icon: Star },
  { href: '/dashboard/settings', label: 'Configuración', icon: Settings },
]

const COLLAPSE_KEY = 'agendita:sidebar-collapsed'

interface DashboardSidebarProps {
  user: User
  business: Business | null
}

export function DashboardSidebar({ user, business }: DashboardSidebarProps) {
  const pathname = usePathname()
  const userName = user.user_metadata?.name || user.email?.split('@')[0] || 'Usuario'
  const mobileItems = navItems.slice(0, 4)

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

  return (
    <>
      <aside
        className={cn(
          'hidden min-h-screen shrink-0 flex-col border-r border-border/50 bg-sidebar transition-[width] duration-200 md:flex',
          collapsed ? 'w-20' : 'w-72',
        )}
      >
        <div className={cn('flex items-center gap-2 p-4', collapsed ? 'justify-center' : 'justify-between px-6 pt-6')}>
          {!collapsed && (
            <div className="min-w-0">
              <Link href="/" className="font-heading text-2xl font-semibold tracking-tight text-primary">
                Agendita
              </Link>
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

        <nav className={cn('flex-1', collapsed ? 'px-2' : 'px-4')}>
          <ul className="space-y-1">
            {navItems.map((item) => {
              const Icon = item.icon
              const isActive = item.href === '/dashboard'
                ? pathname === item.href
                : pathname.startsWith(item.href)

              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    title={collapsed ? item.label : undefined}
                    className={cn(
                      'flex items-center rounded-lg text-sm font-semibold transition-colors',
                      collapsed ? 'justify-center px-0 py-3' : 'gap-3 px-4 py-3',
                      isActive
                        ? 'bg-primary text-primary-foreground shadow-[0_10px_22px_rgba(51,41,32,0.14)]'
                        : 'text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
                    )}
                  >
                    <Icon className="size-5 shrink-0" />
                    {!collapsed && item.label}
                  </Link>
                </li>
              )
            })}
          </ul>
        </nav>

        <div className={cn('border-t border-border/50', collapsed ? 'p-2' : 'p-4')}>
          {!collapsed && (
            <div className="mb-3 rounded-xl bg-card p-4 ring-1 ring-border/60">
              <p className="truncate text-sm font-semibold text-primary">{userName}</p>
              <p className="truncate text-xs text-muted-foreground">{user.email}</p>
            </div>
          )}
          <form action={signOut}>
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
        <nav className="mx-auto grid max-w-md grid-cols-4 gap-1">
          {mobileItems.map((item) => {
            const Icon = item.icon
            const isActive = item.href === '/dashboard'
              ? pathname === item.href
              : pathname.startsWith(item.href)

            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'flex flex-col items-center justify-center gap-1 rounded-lg px-2 py-2 text-[11px] font-semibold transition-colors',
                  isActive ? 'bg-primary text-primary-foreground' : 'text-muted-foreground',
                )}
              >
                <Icon className="size-5" />
                <span>{item.label}</span>
              </Link>
            )
          })}
        </nav>
      </div>
    </>
  )
}
