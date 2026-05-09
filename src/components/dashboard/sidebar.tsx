'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'

const navItems = [
  { href: '/dashboard', label: 'Resumen', icon: '📊' },
  { href: '/dashboard/bookings', label: 'Reservas', icon: '📅' },
  { href: '/dashboard/services', label: 'Servicios', icon: '💅' },
  { href: '/dashboard/customers', label: 'Clientas', icon: '👥' },
  { href: '/dashboard/payments', label: 'Pagos', icon: '💰' },
  { href: '/dashboard/reviews', label: 'Reseñas', icon: '⭐' },
  { href: '/dashboard/settings', label: 'Configuración', icon: '⚙️' },
]

export function DashboardSidebar() {
  const pathname = usePathname()

  return (
    <aside className="w-64 bg-white border-r border-gray-200 min-h-screen flex flex-col">
      <div className="p-6 border-b border-gray-100">
        <Link href="/" className="text-xl font-bold text-pink-600">
          Agendita
        </Link>
        <p className="text-sm text-gray-500 mt-1">Panel de control</p>
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
        <form action="/api/auth/signout" method="post">
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
