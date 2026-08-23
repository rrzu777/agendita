import type { BusinessRole } from '@prisma/client'
import type { LucideIcon } from 'lucide-react'
import {
  CalendarDays,
  Clock3,
  CreditCard,
  LayoutDashboard,
  Megaphone,
  MessageSquareText,
  Package,
  ReceiptText,
  Scissors,
  Settings,
  Sparkles,
  Star,
  Ticket,
  Users,
  UsersRound,
} from 'lucide-react'
import type { Vocabulary } from '@/lib/vocabulary'

export type DashboardNavItem = {
  href: string
  label: string
  icon: LucideIcon
  roles: BusinessRole[]
  mobile: 'primary' | 'more'
  tourId: string
}

const operationalRoles: BusinessRole[] = ['owner', 'admin', 'staff']
const managementRoles: BusinessRole[] = ['owner', 'admin']

function dashboardNavDefinitions(vocabulary: Vocabulary): DashboardNavItem[] {
  return [
    { href: '/dashboard', label: 'Resumen', icon: LayoutDashboard, roles: operationalRoles, mobile: 'primary', tourId: 'dashboard-summary' },
    { href: '/dashboard/bookings', label: 'Reservas', icon: MessageSquareText, roles: operationalRoles, mobile: 'primary', tourId: 'dashboard-bookings' },
    { href: '/dashboard/calendar', label: 'Calendario', icon: CalendarDays, roles: operationalRoles, mobile: 'primary', tourId: 'dashboard-calendar' },
    { href: '/dashboard/services', label: 'Servicios', icon: Scissors, roles: operationalRoles, mobile: 'more', tourId: 'dashboard-services' },
    { href: '/dashboard/equipo', label: vocabulary.Professionals, icon: UsersRound, roles: operationalRoles, mobile: 'more', tourId: 'dashboard-professionals' },
    { href: '/dashboard/availability', label: 'Horarios', icon: Clock3, roles: operationalRoles, mobile: 'more', tourId: 'dashboard-availability' },
    { href: '/dashboard/customers', label: vocabulary.Clients, icon: Users, roles: operationalRoles, mobile: 'more', tourId: 'dashboard-customers' },
    { href: '/dashboard/payments', label: 'Pagos', icon: CreditCard, roles: operationalRoles, mobile: 'more', tourId: 'dashboard-payments' },
    { href: '/dashboard/promociones', label: 'Promociones', icon: Ticket, roles: operationalRoles, mobile: 'more', tourId: 'dashboard-promotions' },
    { href: '/dashboard/fidelizacion', label: 'Fidelización', icon: Sparkles, roles: operationalRoles, mobile: 'more', tourId: 'dashboard-loyalty' },
    { href: '/dashboard/campanas', label: 'Campañas', icon: Megaphone, roles: operationalRoles, mobile: 'more', tourId: 'dashboard-campaigns' },
    { href: '/dashboard/paquetes', label: 'Paquetes', icon: Package, roles: operationalRoles, mobile: 'more', tourId: 'dashboard-packages' },
    { href: '/dashboard/billing', label: 'Facturación', icon: ReceiptText, roles: managementRoles, mobile: 'more', tourId: 'dashboard-billing' },
    { href: '/dashboard/reviews', label: 'Reseñas', icon: Star, roles: operationalRoles, mobile: 'more', tourId: 'dashboard-reviews' },
    { href: '/dashboard/settings', label: 'Configuración', icon: Settings, roles: managementRoles, mobile: 'more', tourId: 'dashboard-settings' },
  ]
}

export function getDashboardNavItems(vocabulary: Vocabulary, role: BusinessRole): DashboardNavItem[] {
  return dashboardNavDefinitions(vocabulary).filter((item) => item.roles.includes(role))
}

export function isDashboardNavItemActive(item: DashboardNavItem, pathname: string) {
  return item.href === '/dashboard' ? pathname === item.href : pathname.startsWith(item.href)
}
