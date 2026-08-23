import { TOUR_CATALOG, TOUR_STEP_BOUNDS, type TourKey } from '@/lib/tours/catalog'
import type { TourDefinition, TourStep } from './tour-types'

type TourDefinitionModule = { definition: TourDefinition }
type TourDefinitionLoader = () => Promise<TourDefinitionModule>
export type TourTargetManifest = Record<string, readonly string[]>

export const TOUR_TARGET_FILES = {
  'dashboard-checklist': ['src/components/dashboard/setup-checklist.tsx'],
  'nav-desktop': ['src/components/dashboard/sidebar.tsx'],
  'nav-mobile-more': ['src/components/dashboard/mobile-more-menu.tsx'],
  'bookings-new': ['src/app/dashboard/bookings/page.tsx'],
  'bookings-search': ['src/app/dashboard/bookings/page.tsx'],
  'bookings-transfer': ['src/components/dashboard/pending-transfers-section.tsx'],
  'dashboard-new-booking': ['src/app/dashboard/page.tsx'],
  'bookings-status': ['src/app/dashboard/bookings/page.tsx'],
  'bookings-actions': [
    'src/components/dashboard/booking-row-actions.tsx',
    'src/app/dashboard/bookings/page.tsx',
  ],
  'bookings-empty': ['src/app/dashboard/bookings/page.tsx'],
  'payments-stats': ['src/components/dashboard/finance-stats.tsx'],
  'payments-register': ['src/components/dashboard/manual-payment-dialog.tsx'],
  'payments-filters': ['src/components/dashboard/export-csv-button.tsx'],
  'payments-history': ['src/components/dashboard/ledger-table.tsx'],
  'payments-history-empty': ['src/components/dashboard/ledger-table.tsx'],
  'payments-settings': ['src/components/dashboard/sidebar.tsx'],
  'settings-navigation': ['src/components/dashboard/settings/settings-navigation.tsx'],
  'settings-preview': ['src/components/dashboard/settings/public-profile-preview.tsx'],
  'settings-save': ['src/components/dashboard/settings/settings-save-bar.tsx'],
  'tour-help': [
    'src/components/dashboard/tours/tour-help-menu.tsx',
    'src/components/dashboard/mobile-more-menu.tsx',
  ],
} as const

// Las definiciones contextuales se incorporan a este mapa junto con sus targets.
// Un mapa explícito mantiene los chunks y el typecheck deterministas.
const TOUR_DEFINITION_LOADERS = {
  dashboard_intro: () => import('./definitions/dashboard_intro'),
  bookings: () => import('./definitions/bookings'),
  payments: () => import('./definitions/payments'),
  settings: () => import('./definitions/settings'),
} satisfies Partial<Record<TourKey, TourDefinitionLoader>>

type LoadableTourKey = keyof typeof TOUR_DEFINITION_LOADERS

export function getLoadableTourKeys(): LoadableTourKey[] {
  return Object.keys(TOUR_DEFINITION_LOADERS) as LoadableTourKey[]
}

export function getTourStepBound(key: TourKey): number | null {
  if (!isTourDefinitionLoadable(key)) {
    return null
  }
  return TOUR_STEP_BOUNDS[key]
}

export function isTourDefinitionLoadable(key: TourKey): key is LoadableTourKey {
  return Object.hasOwn(TOUR_DEFINITION_LOADERS, key)
}

export async function loadTourDefinition(key: TourKey): Promise<TourDefinition> {
  if (!isTourDefinitionLoadable(key)) {
    throw new Error(`Tour definition is not available for ${key}`)
  }

  const loader = TOUR_DEFINITION_LOADERS[key]
  const { definition } = await loader()
  assertTourDefinitionContract(definition)
  return definition
}

export function assertTourDefinitionContract(definition: TourDefinition): void {
  const catalog = TOUR_CATALOG[definition.key]
  if (!catalog) {
    throw new Error('Tour definition has an unknown key')
  }
  if (definition.version !== catalog.version || definition.route !== catalog.route) {
    throw new Error('Tour definition must match its catalog version and route')
  }
  if (definition.roles.length === 0) {
    throw new Error('Tour definition must include roles')
  }
  if (!rolesExactlyMatchCatalog(definition.roles, catalog.roles)) {
    throw new Error('Tour definition roles must exactly match its catalog entry')
  }

  assertTourTargetManifestContract()
  const stepIds = new Set<string>()
  for (const step of definition.steps) {
    assertStepContract(step, stepIds)
  }
  const stepBound = getTourStepBound(definition.key)
  if (stepBound === null || definition.steps.length !== stepBound) {
    throw new Error('Tour definition steps must match its validated step bound')
  }
}

export function assertTourTargetManifestContract(manifest: TourTargetManifest = TOUR_TARGET_FILES): void {
  for (const [targetId, files] of Object.entries(manifest)) {
    if (!targetId || files.length === 0) {
      throw new Error('Tour target manifest entries need at least one product file')
    }
    if (files.some((file) => !file.trim())) {
      throw new Error('Tour target manifest files must be non-empty')
    }
  }
}

function rolesExactlyMatchCatalog(
  definitionRoles: readonly string[],
  catalogRoles: readonly string[],
): boolean {
  return definitionRoles.length === catalogRoles.length
    && definitionRoles.every((role) => catalogRoles.includes(role))
    && catalogRoles.every((role) => definitionRoles.includes(role))
}

function assertStepContract(step: TourStep, stepIds: Set<string>): void {
  if (!step.id || stepIds.has(step.id)) {
    throw new Error('Tour definition has a duplicate step id')
  }
  stepIds.add(step.id)

  if (!step.targetId || step.viewports.length === 0) {
    throw new Error('Tour step must include target and viewports')
  }
  if (!Number.isFinite(step.waitMs) || step.waitMs < 0) {
    throw new Error('Tour step waitMs must be a non-negative number')
  }
  if (step.targetKind === 'data' && !step.fallbackTargetId) {
    throw new Error('Data-dependent tour steps must include a fallback target')
  }
  if (step.targetKind !== 'static' && step.targetKind !== 'data') {
    throw new Error('Tour step must declare a supported target kind')
  }
  if (!Object.hasOwn(TOUR_TARGET_FILES, step.targetId)) {
    throw new Error('Tour step target must exist in the target manifest')
  }
  if (step.targetKind === 'data' && !Object.hasOwn(TOUR_TARGET_FILES, step.fallbackTargetId)) {
    throw new Error('Tour step fallback target must exist in the target manifest')
  }
}
