import { TOUR_CATALOG } from '@/lib/tours/catalog'
import type { TourDefinition } from '@/components/dashboard/tours/tour-types'

const tour = TOUR_CATALOG.settings

export const definition = {
  key: 'settings',
  version: tour.version,
  route: tour.route,
  roles: tour.roles,
  title: tour.title,
  steps: [
    {
      id: 'navigation',
      targetKind: 'static',
      targetId: 'settings-navigation',
      title: 'Ordena la configuración',
      body: 'Cambia entre Perfil, Reservas, Políticas y Pagos desde aquí.',
      viewports: ['mobile', 'desktop'],
      waitMs: 300,
    },
    {
      id: 'preview',
      targetKind: 'static',
      targetId: 'settings-preview',
      title: 'Revisa tu perfil público',
      body: 'Esta vista previa muestra cómo se presenta tu negocio.',
      viewports: ['mobile', 'desktop'],
      waitMs: 300,
    },
    {
      id: 'save',
      targetKind: 'static',
      targetId: 'settings-save',
      title: 'Guarda los cambios',
      body: 'La barra indica si hay cambios pendientes antes de guardarlos.',
      viewports: ['mobile', 'desktop'],
      waitMs: 300,
    },
    {
      id: 'policies',
      targetKind: 'static',
      targetId: 'settings-policies',
      title: 'Define políticas y avisos',
      body: 'Estos controles definen condiciones y recordatorios de cancelación.',
      viewports: ['mobile', 'desktop'],
      waitMs: 300,
    },
  ],
} satisfies TourDefinition
