import type { BusinessRole } from '@prisma/client'
import type { LucideIcon } from 'lucide-react'
import {
  CalendarDays, ChartNoAxesCombined, Clock3, CreditCard, LayoutDashboard, Megaphone,
  MessageSquareText, Package, ReceiptText, Scissors, Settings, Sparkles, Star, Ticket, Users, UsersRound,
} from 'lucide-react'
import type { Vocabulary } from '@/lib/vocabulary'
import { SETTINGS_SECTIONS, type SettingsSectionKey } from '@/lib/business/settings-navigation'

export type DashboardNavItem = {
  href: string
  label: string
  icon: LucideIcon
  roles: BusinessRole[]
  mobile: 'primary' | 'more'
  tourId: string
}

export type DashboardNavGroup = {
  key: 'today' | 'calendar' | 'bookings' | 'customers' | 'catalogue' | 'growth' | 'finance' | 'settings'
  label: string
  href: string
  icon: LucideIcon
  mobile: 'primary' | 'more'
  items: DashboardNavItem[]
}

const operationalRoles: BusinessRole[] = ['owner', 'admin', 'staff']
const managementRoles: BusinessRole[] = ['owner', 'admin']
const settingsIcons: Record<SettingsSectionKey, LucideIcon> = {
  profile: Settings,
  reservations: CalendarDays,
  policies: MessageSquareText,
  payments: CreditCard,
}

function dashboardNavDefinitions(vocabulary: Vocabulary): DashboardNavItem[] {
  return [
    { href: '/dashboard', label: 'Hoy', icon: LayoutDashboard, roles: operationalRoles, mobile: 'primary', tourId: 'dashboard-summary' },
    { href: '/dashboard/bookings', label: 'Reservas', icon: MessageSquareText, roles: operationalRoles, mobile: 'primary', tourId: 'dashboard-bookings' },
    { href: '/dashboard/calendar', label: 'Calendario', icon: CalendarDays, roles: operationalRoles, mobile: 'primary', tourId: 'dashboard-calendar' },
    { href: '/dashboard/services', label: 'Servicios', icon: Scissors, roles: operationalRoles, mobile: 'more', tourId: 'dashboard-services' },
    { href: '/dashboard/equipo', label: vocabulary.Professionals, icon: UsersRound, roles: operationalRoles, mobile: 'more', tourId: 'dashboard-professionals' },
    { href: '/dashboard/availability', label: 'Disponibilidad', icon: Clock3, roles: operationalRoles, mobile: 'more', tourId: 'dashboard-availability' },
    { href: '/dashboard/customers', label: vocabulary.Clients, icon: Users, roles: operationalRoles, mobile: 'more', tourId: 'dashboard-customers' },
    { href: '/dashboard/payments', label: 'Cobros', icon: CreditCard, roles: operationalRoles, mobile: 'more', tourId: 'dashboard-payments' },
    { href: '/dashboard/promociones', label: 'Promociones', icon: Ticket, roles: operationalRoles, mobile: 'more', tourId: 'dashboard-promotions' },
    { href: '/dashboard/fidelizacion', label: 'Fidelización', icon: Sparkles, roles: operationalRoles, mobile: 'more', tourId: 'dashboard-loyalty' },
    { href: '/dashboard/campanas', label: 'Campañas', icon: Megaphone, roles: operationalRoles, mobile: 'more', tourId: 'dashboard-campaigns' },
    { href: '/dashboard/paquetes', label: 'Paquetes', icon: Package, roles: operationalRoles, mobile: 'more', tourId: 'dashboard-packages' },
    { href: '/dashboard/metricas', label: 'Métricas', icon: ChartNoAxesCombined, roles: managementRoles, mobile: 'more', tourId: 'dashboard-analytics' },
    { href: '/dashboard/billing', label: 'Plan y facturación', icon: ReceiptText, roles: managementRoles, mobile: 'more', tourId: 'dashboard-billing' },
    { href: '/dashboard/reviews', label: 'Reseñas', icon: Star, roles: operationalRoles, mobile: 'more', tourId: 'dashboard-reviews' },
    ...SETTINGS_SECTIONS.map((section) => ({
      href: section.href,
      label: section.label,
      icon: settingsIcons[section.key],
      roles: managementRoles,
      mobile: 'more' as const,
      tourId: `dashboard-settings-${section.key}`,
    })),
  ]
}

export function getDashboardNavItems(vocabulary: Vocabulary, role: BusinessRole): DashboardNavItem[] {
  return dashboardNavDefinitions(vocabulary).filter((item) => item.roles.includes(role))
}

export function getDashboardNavGroups(vocabulary: Vocabulary, role: BusinessRole): DashboardNavGroup[] {
  const byHref = new Map(getDashboardNavItems(vocabulary, role).map((item) => [item.href, item]))
  const group = (
    key: DashboardNavGroup['key'], label: string, hrefs: string[], icon: LucideIcon,
    mobile: DashboardNavGroup['mobile'] = 'more',
  ): DashboardNavGroup | null => {
    const items = hrefs.flatMap((href) => byHref.has(href) ? [byHref.get(href)!] : [])
    return items.length ? { key, label, href: items[0].href, icon, mobile, items } : null
  }

  return [
    group('today', 'Hoy', ['/dashboard'], LayoutDashboard, 'primary'),
    group('calendar', 'Calendario', ['/dashboard/calendar'], CalendarDays, 'primary'),
    group('bookings', 'Reservas', ['/dashboard/bookings'], MessageSquareText, 'primary'),
    group('customers', vocabulary.Clients, ['/dashboard/customers'], Users),
    group('catalogue', 'Catálogo', ['/dashboard/services', '/dashboard/equipo', '/dashboard/availability'], Scissors),
    group('growth', 'Crecimiento', ['/dashboard/metricas', '/dashboard/promociones', '/dashboard/fidelizacion', '/dashboard/campanas', '/dashboard/paquetes', '/dashboard/reviews'], ChartNoAxesCombined),
    group('finance', 'Finanzas', ['/dashboard/payments', '/dashboard/billing'], CreditCard),
    group('settings', 'Configuración', SETTINGS_SECTIONS.map((section) => section.href), Settings),
  ].filter((item): item is DashboardNavGroup => item !== null)
}

export function isDashboardNavItemActive(item: DashboardNavItem, pathname: string) {
  return item.href === '/dashboard' ? pathname === item.href : pathname.startsWith(item.href)
}

export function isDashboardNavGroupActive(group: DashboardNavGroup, pathname: string) {
  return group.items.some((item) => isDashboardNavItemActive(item, pathname))
}
