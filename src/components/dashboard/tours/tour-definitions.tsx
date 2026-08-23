import { TOUR_CATALOG, type TourKey } from '@/lib/tours/catalog'
import type { TourDefinition, TourStep } from './tour-types'

type TourDefinitionModule = { definition: TourDefinition }
type TourDefinitionLoader = () => Promise<TourDefinitionModule>

export const TOUR_TARGET_FILES = {
  'nav-desktop': ['src/components/dashboard/sidebar.tsx'],
  'nav-mobile-more': ['src/components/dashboard/mobile-more-menu.tsx'],
} as const

// Las definiciones contextuales se incorporan a este mapa junto con sus targets.
// Un mapa explícito mantiene los chunks y el typecheck deterministas.
const TOUR_DEFINITION_LOADERS: Partial<Record<TourKey, TourDefinitionLoader>> = {
  dashboard_intro: () => import('./definitions/dashboard_intro'),
}

export async function loadTourDefinition(key: TourKey): Promise<TourDefinition> {
  const loader = TOUR_DEFINITION_LOADERS[key]
  if (!loader) {
    throw new Error(`Tour definition is not available for ${key}`)
  }

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
  if (definition.roles.some((role) => !catalog.roles.some((allowedRole) => allowedRole === role))) {
    throw new Error('Tour definition includes a role outside its catalog entry')
  }

  const stepIds = new Set<string>()
  for (const step of definition.steps) {
    assertStepContract(step, stepIds)
  }
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
