export type SetupChecklistBusiness = {
  id: string
  name: string | null
  slug: string
  subdomain: string | null
  city: string | null
  depositPolicy: string | null
  cancellationPolicy: string | null
}

export type SetupChecklistItem = {
  key: string
  completed: boolean
  label: string
  href: string
}

export type SetupChecklist = {
  completedCount: number
  totalCount: number
  isReady: boolean
  publicUrl: string
  bookingUrl: string
  items: SetupChecklistItem[]
}

export function buildSetupChecklist({
  business,
  servicesCount,
  availabilityCount,
  bookingsCount,
  hasConnectedPaymentAccount,
  publicUrl,
  bookingUrl,
}: {
  business: SetupChecklistBusiness
  servicesCount: number
  availabilityCount: number
  bookingsCount: number
  hasConnectedPaymentAccount: boolean
  publicUrl: string
  bookingUrl: string
}): SetupChecklist {
  const profileComplete = Boolean(business.name?.trim() && business.city?.trim() && (business.subdomain || business.slug))
  const hasServices = servicesCount > 0
  const hasSchedule = availabilityCount > 0
  const hasPaymentInstructions = hasConnectedPaymentAccount || Boolean(business.depositPolicy?.trim())

  const items: SetupChecklistItem[] = [
    { key: 'profile', completed: profileComplete, label: 'Completa el perfil mínimo', href: '/dashboard/settings' },
    { key: 'services', completed: hasServices, label: 'Crea al menos un servicio activo', href: '/dashboard/services' },
    { key: 'schedule', completed: hasSchedule, label: 'Configura horarios activos', href: '/dashboard/availability' },
    { key: 'first_booking', completed: bookingsCount > 0, label: 'Crea o recibe la primera reserva', href: '/dashboard/bookings/new' },
    { key: 'payments', completed: hasPaymentInstructions, label: 'Define pago o instrucciones de abono', href: '/dashboard/settings' },
    { key: 'cancellation_policy', completed: Boolean(business.cancellationPolicy?.trim()), label: 'Revisa tu política de cancelación', href: '/dashboard/settings' },
    { key: 'public_link', completed: Boolean(publicUrl && bookingUrl), label: 'Comparte tu link público', href: bookingUrl },
  ]

  const completedCount = items.filter((item) => item.completed).length

  return {
    completedCount,
    totalCount: items.length,
    isReady: completedCount === items.length && hasServices && hasSchedule,
    publicUrl,
    bookingUrl,
    items,
  }
}
