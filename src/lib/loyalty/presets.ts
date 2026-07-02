import type { AutomaticRuleFormInput, RedemptionOptionFormInput } from './schema'

export type PresetKind = 'base' | 'addon' | 'combo'

/** Escalares del modelo de acumulación que un preset base setea sobre LoyaltyConfig. */
export type EarnModelPatch = {
  pointsLabel: string
  pointsPerVisit: number
  spendPerPoint: number | null
  minSpendToEarn: number | null
}

export type LoyaltyPreset = {
  id: string
  kind: PresetKind
  name: string
  recommended?: boolean
  describe: string[]
  config?: EarnModelPatch
  redemptionOptions?: RedemptionOptionFormInput[]
  rules?: AutomaticRuleFormInput[]
  componentIds?: string[]
}

export type PresetPayload = {
  config: EarnModelPatch | null
  redemptionOptions: RedemptionOptionFormInput[]
  rules: AutomaticRuleFormInput[]
}

export type CurrentLoyaltyState = {
  config: (EarnModelPatch & { programName: string | null }) | null
  existingRuleKinds: string[]
  existingRedemptionSignatures: string[]
}

export type PresetPlan = {
  configToWrite: (EarnModelPatch & { isActive: true; programName: string }) | null
  rulesToCreate: AutomaticRuleFormInput[]
  redemptionsToCreate: RedemptionOptionFormInput[]
  skipped: { rules: string[]; redemptions: string[] }
}

export type ApplyPresetSummary = { applied: string[]; skipped: string[] }

const DEFAULT_PROGRAM_NAME = 'Programa de fidelidad'

const KIND_LABELS: Record<string, string> = {
  birthday: 'Cumpleaños', first_visit: 'Primera visita', review: 'Reseña',
  anniversary: 'Aniversario', winback: 'Reactivar inactivas', referral: 'Referidas',
}

// ─── Catálogo ──────────────────────────────────────────────────────────────

const STAMP_CARD: LoyaltyPreset = {
  id: 'stamp-card', kind: 'base', name: 'Tarjeta de sellos', recommended: true,
  describe: ['Tus clientas ganan 1 sello por visita.', 'A los 10 sellos, un servicio gratis.'],
  config: { pointsLabel: 'sellos', pointsPerVisit: 1, spendPerPoint: null, minSpendToEarn: null },
  redemptionOptions: [{
    name: 'Servicio gratis', rewardType: 'free_service', rewardValue: 0, pointsCost: 10,
    appliesToAll: true, serviceIds: [], maxDiscount: null, grantExpiryDays: null,
    maxRedemptions: null, maxPerCustomer: null, isActive: true,
  }],
}

const POINTS_PER_VISIT: LoyaltyPreset = {
  id: 'points-per-visit', kind: 'base', name: 'Puntos por visita',
  describe: ['Ganan 10 puntos por visita.', 'Con 100 puntos, 20% de descuento.'],
  config: { pointsLabel: 'puntos', pointsPerVisit: 10, spendPerPoint: null, minSpendToEarn: null },
  redemptionOptions: [{
    name: '20% de descuento', rewardType: 'percentage', rewardValue: 20, pointsCost: 100,
    appliesToAll: true, serviceIds: [], maxDiscount: null, grantExpiryDays: null,
    maxRedemptions: null, maxPerCustomer: null, isActive: true,
  }],
}

const BIRTHDAY: LoyaltyPreset = {
  id: 'birthday', kind: 'addon', name: 'Cumpleaños', recommended: true,
  describe: ['En su mes de cumpleaños, 20% de descuento.', 'Válido 30 días.'],
  rules: [{
    kind: 'birthday', isActive: true, priority: 10, rewardKind: 'grant',
    rewardType: 'percentage', rewardValue: 20, appliesToAll: true, serviceIds: [],
    grantExpiryDays: 30, maxPerCustomer: 1, windowDays: 30,
  }],
}

const REFERRAL: LoyaltyPreset = {
  id: 'referral', kind: 'addon', name: 'Refiere una amiga', recommended: true,
  describe: ['Cuando una clienta refiere a alguien nuevo, ambas reciben 20% de descuento.',
    'Se premia al completar la primera visita de la referida.'],
  rules: [{
    kind: 'referral', isActive: true, priority: 10, rewardKind: 'grant',
    rewardType: 'percentage', rewardValue: 20, appliesToAll: true, serviceIds: [],
    grantExpiryDays: 60, beneficiary: 'both',
  }],
}

const WINBACK: LoyaltyPreset = {
  id: 'winback', kind: 'addon', name: 'Reactivar inactivas',
  describe: ['A quien no vuelve en 90 días, 15% para reactivarla.', 'Válido 3 semanas.'],
  rules: [{
    kind: 'winback', isActive: true, priority: 5, rewardKind: 'grant',
    rewardType: 'percentage', rewardValue: 15, appliesToAll: true, serviceIds: [],
    grantExpiryDays: 21, inactivityDays: 90,
  }],
}

const FIRST_VISIT: LoyaltyPreset = {
  id: 'first-visit', kind: 'addon', name: 'Primera visita',
  describe: ['En su primera visita completada, 15% para la próxima.'],
  rules: [{
    kind: 'first_visit', isActive: true, priority: 5, rewardKind: 'grant',
    rewardType: 'percentage', rewardValue: 15, appliesToAll: true, serviceIds: [],
    grantExpiryDays: 45,
  }],
}

const REVIEW: LoyaltyPreset = {
  id: 'review', kind: 'addon', name: 'Premiá las reseñas',
  describe: ['Cuando deja una reseña, 10% de descuento.'],
  rules: [{
    kind: 'review', isActive: true, priority: 5, rewardKind: 'grant',
    rewardType: 'percentage', rewardValue: 10, appliesToAll: true, serviceIds: [],
    grantExpiryDays: 45,
  }],
}

const RECOMMENDED: LoyaltyPreset = {
  id: 'recommended-program', kind: 'combo', name: 'Programa recomendado', recommended: true,
  describe: ['Tarjeta de sellos + Cumpleaños + Refiere una amiga, todo de una.'],
  componentIds: ['stamp-card', 'birthday', 'referral'],
}

export const PRESETS: LoyaltyPreset[] = [
  RECOMMENDED, STAMP_CARD, POINTS_PER_VISIT, BIRTHDAY, REFERRAL, WINBACK, FIRST_VISIT, REVIEW,
]

const byId = new Map(PRESETS.map((p) => [p.id, p]))

// ─── Funciones puras ─────────────────────────────────────────────────────────

/** Firma de una opción de canje para dedup idempotente (incluye appliesToAll). */
export function redemptionSignature(o: {
  rewardType: string; rewardValue: number; pointsCost: number; appliesToAll: boolean
}): string {
  return `${o.rewardType}:${o.rewardValue}:${o.pointsCost}:${o.appliesToAll}`
}

function dedupeRulesByKind(rules: AutomaticRuleFormInput[]): AutomaticRuleFormInput[] {
  const seen = new Set<string>()
  const out: AutomaticRuleFormInput[] = []
  for (const r of rules) {
    if (!seen.has(r.kind)) { seen.add(r.kind); out.push(r) }
  }
  return out
}

/** Aplana un preset a su payload sembrable. Combo: un único base + add-ons, kinds únicos. */
export function buildPresetPayload(presetId: string): PresetPayload {
  const p = byId.get(presetId)
  if (!p) throw new Error(`Preset desconocido: ${presetId}`)
  if (p.kind === 'combo') {
    const components = (p.componentIds ?? []).map((id) => {
      const c = byId.get(id)
      if (!c) throw new Error(`Componente de combo desconocido: ${id}`)
      return c
    })
    const bases = components.filter((c) => c.kind === 'base')
    if (bases.length !== 1) throw new Error(`El combo ${presetId} debe componer exactamente un base`)
    return {
      config: bases[0].config ?? null,
      redemptionOptions: components.flatMap((c) => c.redemptionOptions ?? []),
      rules: dedupeRulesByKind(components.flatMap((c) => c.rules ?? [])),
    }
  }
  return { config: p.config ?? null, redemptionOptions: p.redemptionOptions ?? [], rules: p.rules ?? [] }
}

/** Metadata liviana para el cliente. */
export function presetCatalog(): Array<Pick<LoyaltyPreset, 'id' | 'kind' | 'name' | 'recommended' | 'describe'>> {
  return PRESETS.map(({ id, kind, name, recommended, describe }) => ({ id, kind, name, recommended, describe }))
}

/** Decide, aditivo e idempotente, qué del payload se siembra dado el estado actual. */
export function planPresetApply(payload: PresetPayload, state: CurrentLoyaltyState): PresetPlan {
  let configToWrite: PresetPlan['configToWrite'] = null
  if (payload.config) {
    const existing = state.config?.programName?.trim()
    configToWrite = { ...payload.config, isActive: true, programName: existing || DEFAULT_PROGRAM_NAME }
  }

  const kinds = new Set(state.existingRuleKinds)
  const rulesToCreate: AutomaticRuleFormInput[] = []
  const skippedRules: string[] = []
  for (const r of payload.rules) {
    if (kinds.has(r.kind)) { skippedRules.push(r.kind); continue }
    kinds.add(r.kind); rulesToCreate.push(r)
  }

  const sigs = new Set(state.existingRedemptionSignatures)
  const redemptionsToCreate: RedemptionOptionFormInput[] = []
  const skippedRedemptions: string[] = []
  for (const o of payload.redemptionOptions) {
    const sig = redemptionSignature({
      rewardType: o.rewardType, rewardValue: Number(o.rewardValue),
      pointsCost: Number(o.pointsCost), appliesToAll: o.appliesToAll,
    })
    if (sigs.has(sig)) { skippedRedemptions.push(o.name); continue }
    sigs.add(sig); redemptionsToCreate.push(o)
  }

  return { configToWrite, rulesToCreate, redemptionsToCreate, skipped: { rules: skippedRules, redemptions: skippedRedemptions } }
}

/** Resumen legible para el picker: qué se encendió vs qué ya existía. */
export function summarizeApply(plan: PresetPlan): ApplyPresetSummary {
  const applied: string[] = []
  const skipped: string[] = []
  if (plan.configToWrite) applied.push('Programa base (cómo se acumula)')
  for (const r of plan.rulesToCreate) applied.push(KIND_LABELS[r.kind] ?? r.kind)
  for (const o of plan.redemptionsToCreate) applied.push(o.name)
  for (const k of plan.skipped.rules) skipped.push(KIND_LABELS[k] ?? k)
  for (const n of plan.skipped.redemptions) skipped.push(n)
  return { applied, skipped }
}
