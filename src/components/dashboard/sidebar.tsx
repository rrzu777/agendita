'use client'

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
  Scissors,
  Settings,
  Star,
  Users,
} from 'lucide-react'

const navItems = [
  { href: '/dashboard', label: 'Resumen', icon: LayoutDashboard },
  { href: '/dashboard/bookings', label: 'Reservas', icon: MessageSquareText },
  { href: '/dashboard/calendar', label: 'Calendario', icon: CalendarDays },
  { href: '/dashboard/services', label: 'Servicios', icon: Scissors },
  { href: '/dashboard/availability', label: 'Horarios', icon: Clock3 },
  { href: '/dashboard/customers', label: 'Clientas', icon: Users },
  { href: '/dashboard/payments', label: 'Pagos', icon: CreditCard },
  { href: '/dashboard/reviews', label: 'Reseñas', icon: Star },
  { href: '/dashboard/settings', label: 'Configuración', icon: Settings },
]

interface DashboardSidebarProps {
  user: User
  business: Business | null
}

export function DashboardSidebar({ user, business }: DashboardSidebarProps) {
  const pathname = usePathname()
  const userName = user.user_metadata?.name || user.email?.split('@')[0] || 'Usuario'
  const mobileItems = navItems.slice(0, 4)

  return (
    <>
    <aside className="hidden min-h-screen w-72 shrink-0 flex-col border-r border-border/50 bg-sidebar md:flex">
      <div className="p-6">
        <Link href="/" className="text-3xl font-semibold tracking-normal text-primary">
          Agendita
        </Link>
        {business && (
          <p className="mt-2 text-sm font-semibold text-sidebar-foreground">{business.name}</p>
        )}
        <p className="studio-eyebrow mt-1">Panel de control</p>
      </div>
      <nav className="flex-1 px-4">
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
                className={cn(
                  'flex items-center gap-3 rounded-lg px-4 py-3 text-sm font-semibold transition-colors',
                  isActive
                    ? 'bg-primary text-primary-foreground shadow-[0_10px_22px_rgba(51,41,32,0.14)]'
                    : 'text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
                )}
              >
                <Icon className="size-5" />
                {item.label}
              </Link>
            </li>
            )
          })}
        </ul>
      </nav>
      <div className="border-t border-border/50 p-4">
        <div className="mb-3 rounded-xl bg-card p-4 ring-1 ring-border/60">
          <p className="text-sm font-semibold text-primary">{userName}</p>
          <p className="truncate text-xs text-muted-foreground">{user.email}</p>
        </div>
        <form action={signOut}>
          <button
            type="submit"
            className="flex w-full items-center gap-3 rounded-lg px-4 py-3 text-left text-sm font-semibold text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          >
            <LogOut className="size-5" />
            Cerrar sesión
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
                isActive ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'
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
