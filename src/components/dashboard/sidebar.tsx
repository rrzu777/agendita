'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import { signOut } from '@/lib/auth/actions'
import type { User } from '@supabase/supabase-js'
import type { Business } from '@prisma/client'

const navItems = [
  { href: '/dashboard', label: 'Resumen', icon: '📊' },
  { href: '/dashboard/bookings', label: 'Reservas', icon: '📅' },
  { href: '/dashboard/calendar', label: 'Calendario', icon: '📆' },
  { href: '/dashboard/services', label: 'Servicios', icon: '💅' },
  { href: '/dashboard/availability', label: 'Horarios', icon: '🕐' },
  { href: '/dashboard/customers', label: 'Clientas', icon: '👥' },
  { href: '/dashboard/payments', label: 'Pagos', icon: '💰' },
  { href: '/dashboard/reviews', label: 'Reseñas', icon: '⭐' },
  { href: '/dashboard/settings', label: 'Configuración', icon: '⚙️' },
]

interface DashboardSidebarProps {
  user: User
  business: Business | null
}

export function DashboardSidebar({ user, business }: DashboardSidebarProps) {
  const pathname = usePathname()
  const userName = user.user_metadata?.name || user.email?.split('@')[0] || 'Usuario'

  return (
    <aside className="w-64 bg-white border-r border-gray-200 min-h-screen flex flex-col">
      <div className="p-6 border-b border-gray-100">
        <Link href="/" className="text-xl font-bold text-pink-600">
          Agendita
        </Link>
        {business && (
          <p className="text-sm font-medium text-gray-700 mt-1">{business.name}</p>
        )}
        <p className="text-xs text-gray-500 mt-1">Panel de control</p>
      </div>
      <nav className="flex-1 p-4">
        <ul className="space-y-1">
          {navItems.map((item) => (
            <li key={item.href}>
              <Link
                href={item.href}
                className={cn(
                  'flex items-center gap-3 px-4 py-3 rounded-lg transition-colors',
                  pathname === item.href
                    ? 'bg-pink-50 text-pink-700 font-medium'
                    : 'text-gray-700 hover:bg-gray-50'
                )}
              >
                <span>{item.icon}</span>
                {item.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <div className="p-4 border-t border-gray-100">
        <div className="px-4 py-2 mb-2">
          <p className="text-sm font-medium text-gray-900">{userName}</p>
          <p className="text-xs text-gray-500 truncate">{user.email}</p>
        </div>
        <form action={signOut}>
          <button
            type="submit"
            className="flex items-center gap-3 px-4 py-3 w-full text-left text-gray-700 hover:bg-gray-50 rounded-lg transition-colors"
          >
            <span>🚪</span>
            Cerrar sesión
          </button>
        </form>
      </div>
    </aside>
  )
}
