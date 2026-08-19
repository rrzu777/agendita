export const SETTINGS_SECTIONS = [
  { key: 'profile', href: '/dashboard/settings/profile', label: 'Perfil público', prefetch: true },
  { key: 'reservations', href: '/dashboard/settings/reservations', label: 'Reservas', prefetch: true },
  { key: 'policies', href: '/dashboard/settings/policies', label: 'Políticas y avisos', prefetch: true },
  { key: 'payments', href: '/dashboard/settings/payments', label: 'Pagos', prefetch: false },
] as const

export type SettingsSectionKey = (typeof SETTINGS_SECTIONS)[number]['key']
