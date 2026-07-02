# Presets de fidelización — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que una dueña encienda un programa de fidelización coherente en un clic (presets base + add-on + combo), aditivo e idempotente, reusando el motor B1/B2/B3.

**Architecture:** Un módulo puro (`presets.ts`) define el catálogo y la lógica de planificación (`buildPresetPayload`, `planPresetApply`, `summarizeApply`). Una server action (`applyLoyaltyPreset`) carga el estado, planifica y siembra en una transacción con advisory lock, reusando los write-paths existentes. La UI es un picker de cards con confirmación y resumen. Sin migración, sin tabla nueva.

**Tech Stack:** Next.js 16 (App Router, RSC + server actions), React 19, Prisma 5.22 + Postgres, Zod, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-07-01-loyalty-presets-design.md`

**Reglas de repo (no negociables):**
- Módulos `'use server'` exportan **solo** funciones async; helpers module-local sin `export`.
- Todo `revalidate*` con `await`.
- Currency-clean: recompensas como % del precio; nada de moneda hardcodeada; `formatMoney` donde se muestre dinero.
- `presets.ts` **sin imports de servidor** (lo importa un client component).
- Mantener la suite verde. No mergear hasta OK explícito; PR al final. **No hay migración** en esta rebanada.

---

## File Structure

- **Crear** `src/lib/loyalty/presets.ts` — catálogo (datos) + tipos + funciones puras (`buildPresetPayload`, `planPresetApply`, `summarizeApply`, `redemptionSignature`, `presetCatalog`). Sin imports de servidor.
- **Modificar** `src/server/actions/loyalty.ts` — `applyLoyaltyPreset` (async, exportada) + helpers module-local (`loadLoyaltyState`, `createAutomaticRuleFromInput`).
- **Modificar** `src/app/dashboard/fidelizacion/loyalty-config-form.tsx` — `pointsLabel` de `<Input>` a dropdown.
- **Crear** `src/app/dashboard/fidelizacion/preset-picker.tsx` — client UI (cards + confirm + resumen).
- **Modificar** `src/app/dashboard/fidelizacion/page.tsx` — render del picker arriba.
- **Crear** `tests/unit/loyalty-presets.test.ts` — unit del core puro.
- **Crear** `tests/e2e/loyalty-presets.spec.ts` — e2e contra el stack real.

---

### Task 1: `presets.ts` — catálogo y core puro (con tests)

**Modelo sugerido:** estándar (alineación con los zod schemas existentes).

**Files:**
- Create: `src/lib/loyalty/presets.ts`
- Test: `tests/unit/loyalty-presets.test.ts`

- [ ] **Step 1: Escribir el test**

Crear `tests/unit/loyalty-presets.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { loyaltyConfigSchema, redemptionOptionSchema, automaticRuleSchema } from '@/lib/loyalty/schema'
import {
  PRESETS, buildPresetPayload, planPresetApply, redemptionSignature,
  summarizeApply, presetCatalog, type CurrentLoyaltyState,
} from '@/lib/loyalty/presets'

const cleanState: CurrentLoyaltyState = { config: null, existingRuleKinds: [], existingRedemptionSignatures: [] }

describe('catálogo de presets', () => {
  for (const p of PRESETS) {
    it(`${p.id}: produce un payload válido contra los schemas`, () => {
      const payload = buildPresetPayload(p.id)
      if (payload.config) {
        expect(loyaltyConfigSchema.safeParse({ ...payload.config, isActive: true, programName: 'X' }).success).toBe(true)
      }
      for (const o of payload.redemptionOptions) expect(redemptionOptionSchema.safeParse(o).success).toBe(true)
      for (const r of payload.rules) expect(automaticRuleSchema.safeParse(r).success).toBe(true)
    })
  }

  it('recommended-program: un solo base, kinds únicos, config presente', () => {
    const payload = buildPresetPayload('recommended-program')
    expect(payload.config).not.toBeNull()
    const kinds = payload.rules.map((r) => r.kind)
    expect(new Set(kinds).size).toBe(kinds.length)
    expect(kinds).toContain('birthday')
    expect(kinds).toContain('referral')
  })

  it('buildPresetPayload lanza con id inexistente', () => {
    expect(() => buildPresetPayload('nope')).toThrow()
  })

  it('describe coincide con el payload (guard anti-drift)', () => {
    const stamp = PRESETS.find((x) => x.id === 'stamp-card')!.describe.join(' ')
    expect(stamp).toContain('1 sello')
    expect(stamp).toContain('10 sellos')
    const bday = PRESETS.find((x) => x.id === 'birthday')!.describe.join(' ')
    expect(bday).toContain('20%')
  })
})

describe('planPresetApply — aditivo e idempotente', () => {
  it('estado limpio: siembra config, reglas y canje', () => {
    const plan = planPresetApply(buildPresetPayload('recommended-program'), cleanState)
    expect(plan.configToWrite).toMatchObject({ pointsLabel: 'sellos', pointsPerVisit: 1, isActive: true })
    expect(plan.configToWrite?.programName).toBe('Programa de fidelidad')
    expect(plan.rulesToCreate.map((r) => r.kind).sort()).toEqual(['birthday', 'referral'])
    expect(plan.redemptionsToCreate).toHaveLength(1)
  })

  it('kind existente (activo o archivado) se saltea, no se resucita', () => {
    const plan = planPresetApply(buildPresetPayload('recommended-program'), { ...cleanState, existingRuleKinds: ['birthday'] })
    expect(plan.rulesToCreate.map((r) => r.kind)).toEqual(['referral'])
    expect(plan.skipped.rules).toContain('birthday')
  })

  it('redemption de firma equivalente se saltea', () => {
    const sig = redemptionSignature({ rewardType: 'free_service', rewardValue: 0, pointsCost: 10, appliesToAll: true })
    const plan = planPresetApply(buildPresetPayload('stamp-card'), { ...cleanState, existingRedemptionSignatures: [sig] })
    expect(plan.redemptionsToCreate).toHaveLength(0)
    expect(plan.skipped.redemptions).toContain('Servicio gratis')
  })

  it('config previa: pisa earn scalars, preserva programName', () => {
    const plan = planPresetApply(buildPresetPayload('stamp-card'), {
      config: { pointsLabel: 'puntos', pointsPerVisit: 10, spendPerPoint: null, minSpendToEarn: null, programName: 'Mi club' },
      existingRuleKinds: [], existingRedemptionSignatures: [],
    })
    expect(plan.configToWrite).toMatchObject({ pointsLabel: 'sellos', pointsPerVisit: 1, programName: 'Mi club', isActive: true })
  })

  it('base-sobre-base: crea la segunda redemption (firma distinta)', () => {
    const stampSig = redemptionSignature({ rewardType: 'free_service', rewardValue: 0, pointsCost: 10, appliesToAll: true })
    const plan = planPresetApply(buildPresetPayload('points-per-visit'), { ...cleanState, existingRedemptionSignatures: [stampSig] })
    expect(plan.redemptionsToCreate).toHaveLength(1)
  })

  it('re-aplicar el mismo preset es idempotente', () => {
    const payload = buildPresetPayload('recommended-program')
    const first = planPresetApply(payload, cleanState)
    const state: CurrentLoyaltyState = {
      config: { ...first.configToWrite! },
      existingRuleKinds: first.rulesToCreate.map((r) => r.kind),
      existingRedemptionSignatures: first.redemptionsToCreate.map((o) =>
        redemptionSignature({ rewardType: o.rewardType, rewardValue: Number(o.rewardValue), pointsCost: Number(o.pointsCost), appliesToAll: o.appliesToAll })),
    }
    const second = planPresetApply(payload, state)
    expect(second.rulesToCreate).toHaveLength(0)
    expect(second.redemptionsToCreate).toHaveLength(0)
  })
})

describe('summarizeApply / presetCatalog', () => {
  it('summarizeApply lista aplicados y salteados', () => {
    const plan = planPresetApply(buildPresetPayload('recommended-program'), { ...cleanState, existingRuleKinds: ['birthday'] })
    const s = summarizeApply(plan)
    expect(s.applied).toContain('Referidas')
    expect(s.skipped).toContain('Cumpleaños')
  })

  it('presetCatalog expone metadata de display', () => {
    const cat = presetCatalog()
    expect(cat.find((c) => c.id === 'stamp-card')?.name).toBe('Tarjeta de sellos')
    expect(cat.every((c) => Array.isArray(c.describe))).toBe(true)
  })
})
```

- [ ] **Step 2: Correr el test y verlo fallar**

Run: `npx vitest --run tests/unit/loyalty-presets.test.ts`
Expected: FAIL (`Cannot find module '@/lib/loyalty/presets'`).

- [ ] **Step 3: Implementar `presets.ts`**

Crear `src/lib/loyalty/presets.ts`:

```ts
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
```

- [ ] **Step 4: Correr el test y verlo pasar**

Run: `npx vitest --run tests/unit/loyalty-presets.test.ts`
Expected: PASS (todos verdes).

- [ ] **Step 5: Typecheck + commit**

Run: `npx tsc --noEmit` (esperado: sin errores)

```bash
git add src/lib/loyalty/presets.ts tests/unit/loyalty-presets.test.ts
git commit -m "feat(loyalty): presets core puro (catálogo + plan aditivo idempotente)"
```

---

### Task 2: `applyLoyaltyPreset` — server action

**Modelo sugerido:** estándar (integración multi-tabla, reusa write-paths).

**Files:**
- Modify: `src/server/actions/loyalty.ts`

> **Nota:** el comportamiento de esta action se verifica end-to-end en la Task 5 (e2e). La lógica que delega (`buildPresetPayload`/`planPresetApply`/`summarizeApply`) ya está cubierta por unit en Task 1. No se agrega unit test con mocks de Prisma (el repo cubre las actions con auth vía e2e).

- [ ] **Step 1: Ampliar imports**

En `src/server/actions/loyalty.ts`, en el import de `@/lib/loyalty/schema` (hoy línea 8) agregar el tipo `AutomaticRuleInput`:

```ts
import { loyaltyConfigSchema, adjustPointsSchema, redemptionOptionSchema, redeemSchema, automaticRuleSchema, buildConditions, type AutomaticRuleInput } from '@/lib/loyalty/schema'
```

Agregar un import nuevo debajo del import de `conditionKind` (hoy línea 14):

```ts
import { buildPresetPayload, planPresetApply, summarizeApply, redemptionSignature, type CurrentLoyaltyState, type ApplyPresetSummary } from '@/lib/loyalty/presets'
```

- [ ] **Step 2: Agregar helpers module-local**

En la sección de helpers NO exportados (después de `runRedemption`, antes de `// Exported async actions`), agregar:

```ts
/** Crea una Promotion automatic a partir de una regla ya validada. Module-local
 *  (los módulos 'use server' solo exportan funciones async). */
async function createAutomaticRuleFromInput(
  tx: Prisma.TransactionClient, businessId: string, userId: string, d: AutomaticRuleInput,
): Promise<void> {
  await tx.promotion.create({
    data: {
      businessId, triggerType: 'automatic',
      name: `auto:${d.kind}`, rewardType: d.rewardType ?? 'percentage', rewardValue: d.rewardValue,
      maxDiscount: d.maxDiscount, appliesToAll: d.appliesToAll, rewardPoints: d.rewardPoints,
      grantExpiryDays: d.grantExpiryDays, priority: d.priority, isActive: d.isActive,
      maxPerCustomer: d.maxPerCustomer,
      conditions: buildConditions(d) as Prisma.InputJsonValue,
      createdByUserId: userId,
      services: d.rewardKind === 'grant' && !d.appliesToAll
        ? { connect: d.serviceIds.map((sid) => ({ id: sid })) } : undefined,
    },
  })
}

/** Estado de fidelización relevante para planificar un preset (dentro de una tx). */
async function loadLoyaltyState(tx: Prisma.TransactionClient, businessId: string): Promise<{
  state: CurrentLoyaltyState; configRow: Awaited<ReturnType<typeof tx.loyaltyConfig.findUnique>>
}> {
  const [configRow, autoRules, redemptions] = await Promise.all([
    tx.loyaltyConfig.findUnique({ where: { businessId } }),
    tx.promotion.findMany({ where: automaticRuleWhere(businessId), select: { conditions: true } }),
    tx.promotion.findMany({
      where: { ...redemptionOptionWhere(businessId), isActive: true },
      select: { rewardType: true, rewardValue: true, pointsCost: true, appliesToAll: true },
    }),
  ])
  const state: CurrentLoyaltyState = {
    config: configRow ? {
      pointsLabel: configRow.pointsLabel, pointsPerVisit: configRow.pointsPerVisit,
      spendPerPoint: configRow.spendPerPoint, minSpendToEarn: configRow.minSpendToEarn,
      programName: configRow.programName,
    } : null,
    existingRuleKinds: autoRules
      .map((p) => conditionKind(p.conditions))
      .filter((k): k is string => k != null),
    existingRedemptionSignatures: redemptions.map((o) => redemptionSignature({
      rewardType: o.rewardType, rewardValue: o.rewardValue, pointsCost: o.pointsCost ?? 0, appliesToAll: o.appliesToAll,
    })),
  }
  return { state, configRow }
}
```

- [ ] **Step 3: Agregar la action exportada**

Al final del archivo, agregar:

```ts
export async function applyLoyaltyPreset(presetId: unknown): Promise<ApplyPresetSummary> {
  const { businessId, user } = await requireBusinessRole(['owner', 'admin'])
  const limit = await checkRateLimit('loyalty-preset', 30, 60000, { userId: user.id, businessId })
  if (!limit.success) throw new Error('Demasiadas solicitudes. Intenta más tarde.')
  if (typeof presetId !== 'string') throw new Error('Preset inválido')
  const payload = buildPresetPayload(presetId) // lanza si el id no existe

  const summary = await prisma.$transaction(async (tx) => {
    // Advisory lock: serializa los applies de este negocio. Sin unique de DB para
    // "una regla por kind" (kind vive en JSON) ni para la firma de canje, dos applies
    // concurrentes (o doble-clic) crearían duplicados. $executeRaw (no $queryRaw).
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${businessId}))`

    const { state, configRow } = await loadLoyaltyState(tx, businessId)
    const plan = planPresetApply(payload, state)

    if (plan.configToWrite) {
      const merged = { ...configRow, ...plan.configToWrite }
      const parsed = loyaltyConfigSchema.safeParse(merged)
      if (!parsed.success) throw new Error('Config de fidelización inválida')
      await tx.loyaltyConfig.upsert({
        where: { businessId },
        create: { businessId, ...parsed.data, updatedByUserId: user.id },
        update: { ...parsed.data, updatedByUserId: user.id },
      })
    }

    for (const r of plan.rulesToCreate) {
      const parsed = automaticRuleSchema.safeParse(r)
      if (!parsed.success) throw new Error('Regla de preset inválida')
      await createAutomaticRuleFromInput(tx, businessId, user.id, parsed.data)
    }

    for (const o of plan.redemptionsToCreate) {
      const parsed = redemptionOptionSchema.safeParse(o)
      if (!parsed.success) throw new Error('Recompensa de preset inválida')
      const d = parsed.data
      await tx.promotion.create({
        data: {
          businessId, triggerType: 'granted', name: d.name, rewardType: d.rewardType,
          rewardValue: d.rewardValue, maxDiscount: d.maxDiscount, appliesToAll: d.appliesToAll,
          pointsCost: d.pointsCost, grantExpiryDays: d.grantExpiryDays,
          maxRedemptions: d.maxRedemptions, maxPerCustomer: d.maxPerCustomer,
          isActive: d.isActive, createdByUserId: user.id,
        },
      })
    }

    return summarizeApply(plan)
  })

  await revalidatePath('/dashboard/fidelizacion')
  return summary
}
```

- [ ] **Step 4: Typecheck + lint**

Run: `npx tsc --noEmit` (esperado: sin errores)
Run: `npm run lint` (esperado: 0 errores)

Si `loadLoyaltyState` da error de tipo en el `configRow` de retorno, reemplazar el tipo por `LoyaltyConfig | null` importando `import type { LoyaltyConfig } from '@prisma/client'`.

- [ ] **Step 5: Verificar suite unit + commit**

Run: `npm run test` (esperado: toda la suite verde, incluye Task 1)

```bash
git add src/server/actions/loyalty.ts
git commit -m "feat(loyalty): applyLoyaltyPreset (siembra aditiva con advisory lock)"
```

---

### Task 3: `pointsLabel` → dropdown

**Modelo sugerido:** barato (cambio de UI mecánico).

**Files:**
- Modify: `src/app/dashboard/fidelizacion/loyalty-config-form.tsx`

> **Verificación:** cubierto por la Task 5 (el e2e lee el valor de `pointsLabel`). No hay unit test de componente (el repo requiere mock de `next/navigation` para renderizar client components y este cambio es puramente presentacional).

- [ ] **Step 1: Agregar el sub-componente de dropdown**

En `src/app/dashboard/fidelizacion/loyalty-config-form.tsx`, al final del archivo (después de `function Field(...)`), agregar:

```tsx
const POINTS_LABEL_OPTIONS = ['puntos', 'estrellas', 'sellos', 'visitas']

function PointsLabelField({ defaultValue }: { defaultValue: string }) {
  const isPreset = POINTS_LABEL_OPTIONS.includes(defaultValue)
  const [choice, setChoice] = useState(isPreset ? defaultValue : 'otro')

  return (
    <div className="space-y-1.5">
      <Label htmlFor="pointsLabel-choice">Nombre de la unidad</Label>
      <select
        id="pointsLabel-choice"
        value={choice}
        onChange={(e) => setChoice(e.target.value)}
        className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
      >
        {POINTS_LABEL_OPTIONS.map((o) => (
          <option key={o} value={o}>{o}</option>
        ))}
        <option value="otro">Otro…</option>
      </select>
      {choice === 'otro' ? (
        <Input name="pointsLabel" defaultValue={isPreset ? '' : defaultValue} placeholder="Ej. corazones" required />
      ) : (
        <input type="hidden" name="pointsLabel" value={choice} />
      )}
    </div>
  )
}
```

- [ ] **Step 2: Usar el dropdown en el form**

En el mismo archivo, reemplazar la línea del `Field` de `pointsLabel` (hoy:
`<Field name="pointsLabel" label="Nombre de la unidad (ej. puntos, estrellas)" defaultValue={config?.pointsLabel ?? 'puntos'} />`)
por:

```tsx
      <PointsLabelField defaultValue={config?.pointsLabel ?? 'puntos'} />
```

- [ ] **Step 3: Verificar que `useState` esté importado**

El archivo ya importa `useState` (línea 3: `import { useState, useTransition } from 'react'`). Confirmarlo; si faltara, agregarlo.

- [ ] **Step 4: Typecheck + lint + commit**

Run: `npx tsc --noEmit` (esperado: sin errores)
Run: `npm run lint` (esperado: 0 errores)

```bash
git add src/app/dashboard/fidelizacion/loyalty-config-form.tsx
git commit -m "feat(loyalty): pointsLabel como dropdown (opciones + otro)"
```

---

### Task 4: `preset-picker.tsx` + wire en `page.tsx`

**Modelo sugerido:** estándar (UI + wiring de action).

**Files:**
- Create: `src/app/dashboard/fidelizacion/preset-picker.tsx`
- Modify: `src/app/dashboard/fidelizacion/page.tsx`

> **Verificación:** cubierto por la Task 5 (e2e).

- [ ] **Step 1: Crear el picker**

Crear `src/app/dashboard/fidelizacion/preset-picker.tsx`:

```tsx
'use client'

import { useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { applyLoyaltyPreset } from '@/server/actions/loyalty'
import type { ApplyPresetSummary } from '@/lib/loyalty/presets'

type PresetCard = {
  id: string
  kind: 'base' | 'addon' | 'combo'
  name: string
  recommended?: boolean
  describe: string[]
}

export function PresetPicker({ presets, hasActiveProgram }: { presets: PresetCard[]; hasActiveProgram: boolean }) {
  const combo = presets.filter((p) => p.kind === 'combo')
  const bases = presets.filter((p) => p.kind === 'base')
  const addons = presets.filter((p) => p.kind === 'addon')

  return (
    <section className="studio-card mb-6 p-4">
      <h3 className="text-lg font-semibold text-primary">Programas recomendados</h3>
      <p className="text-sm text-muted-foreground">
        Encendé un programa completo en un clic y ajustalo abajo. No se borra lo que ya configuraste.
      </p>

      {combo.length > 0 && (
        <div className="mt-4 grid gap-3">
          {combo.map((p) => <Card key={p.id} preset={p} hasActiveProgram={hasActiveProgram} />)}
        </div>
      )}

      <h4 className="mt-6 text-sm font-semibold text-foreground">Elegí cómo ganan (programa base)</h4>
      <div className="mt-2 grid gap-3 sm:grid-cols-2">
        {bases.map((p) => <Card key={p.id} preset={p} hasActiveProgram={hasActiveProgram} />)}
      </div>

      <h4 className="mt-6 text-sm font-semibold text-foreground">Sumá recompensas automáticas</h4>
      <div className="mt-2 grid gap-3 sm:grid-cols-2">
        {addons.map((p) => <Card key={p.id} preset={p} hasActiveProgram={hasActiveProgram} />)}
      </div>
    </section>
  )
}

function Card({ preset, hasActiveProgram }: { preset: PresetCard; hasActiveProgram: boolean }) {
  const [confirming, setConfirming] = useState(false)
  const [isPending, start] = useTransition()
  const [summary, setSummary] = useState<ApplyPresetSummary | null>(null)
  const [error, setError] = useState<string | null>(null)
  const isBaseLike = preset.kind === 'base' || preset.kind === 'combo'

  function apply() {
    setError(null)
    start(async () => {
      try {
        const res = await applyLoyaltyPreset(preset.id)
        setSummary(res)
        setConfirming(false)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Error al aplicar')
      }
    })
  }

  return (
    <div className="rounded-lg border border-border p-4">
      <div className="flex items-start justify-between gap-2">
        <h5 className="font-medium text-foreground">{preset.name}</h5>
        {preset.recommended && (
          <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">
            Recomendado
          </span>
        )}
      </div>
      <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
        {preset.describe.map((line, i) => <li key={i}>{line}</li>)}
      </ul>

      {!confirming && !summary && (
        <Button type="button" size="sm" className="mt-3" disabled={isPending} onClick={() => setConfirming(true)}>
          Aplicar
        </Button>
      )}

      {confirming && (
        <div className="mt-3 space-y-2">
          <p className="text-xs text-muted-foreground">
            Se aplicará sobre tu programa actual sin borrar lo que ya configuraste.
          </p>
          {isBaseLike && hasActiveProgram && (
            <p className="text-xs text-amber-600">
              Ya tenés un programa activo. Esto cambiará cómo se acumula y sumará una recompensa nueva;
              tus puntos acumulados no se pierden.
            </p>
          )}
          <div className="flex gap-2">
            <Button type="button" size="sm" disabled={isPending} onClick={apply}>
              {isPending ? 'Aplicando…' : 'Confirmar'}
            </Button>
            <Button type="button" size="sm" variant="ghost" disabled={isPending} onClick={() => setConfirming(false)}>
              Cancelar
            </Button>
          </div>
        </div>
      )}

      {summary && (
        <div className="mt-3 text-xs text-green-600">
          {summary.applied.length > 0 && <p>Se encendió: {summary.applied.join(', ')}.</p>}
          {summary.skipped.length > 0 && <p className="text-muted-foreground">Ya tenías: {summary.skipped.join(', ')}.</p>}
        </div>
      )}

      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
    </div>
  )
}
```

- [ ] **Step 2: Wire en `page.tsx`**

En `src/app/dashboard/fidelizacion/page.tsx`:

Agregar el import (junto a los otros imports de `./`):

```tsx
import { PresetPicker } from './preset-picker'
import { presetCatalog } from '@/lib/loyalty/presets'
```

Dentro del `<div className="mx-auto max-w-2xl">`, como **primer** hijo (antes de `<LoyaltyConfigForm ... />`), agregar:

```tsx
          <PresetPicker presets={presetCatalog()} hasActiveProgram={config?.isActive ?? false} />
```

- [ ] **Step 3: Typecheck + lint**

Run: `npx tsc --noEmit` (esperado: sin errores)
Run: `npm run lint` (esperado: 0 errores)

- [ ] **Step 4: Commit**

```bash
git add src/app/dashboard/fidelizacion/preset-picker.tsx src/app/dashboard/fidelizacion/page.tsx
git commit -m "feat(loyalty): UI de presets (picker + confirm + resumen)"
```

---

### Task 5: e2e Playwright + gate de suite

**Modelo sugerido:** estándar.

**Files:**
- Create: `tests/e2e/loyalty-presets.spec.ts`

**Contexto del harness e2e** (de `tests/e2e/loyalty-automatic.spec.ts`):
- Auth por header bypass: `setOwnerAuth(page)` setea `x-e2e-test-user-email` + `x-e2e-auth-secret`.
- `gotoStable(page, path)` reintenta blips del dev server. `waitForHydration(page)` espera JS atado.
- Negocio sembrado: owner `owner@mimosnails.com`. Corre serializado (`workers:1`).
- **Orden de archivos:** Playwright corre alfabético; `loyalty-automatic` corre **antes** que `loyalty-presets`, así que este spec no corrompe al anterior. Aplicar es aditivo/idempotente, así que dejar el negocio con "sellos" no rompe corridas futuras (cada spec setea lo suyo).

- [ ] **Step 1: Escribir el e2e**

Crear `tests/e2e/loyalty-presets.spec.ts`:

```ts
import { test, expect, Page } from '@playwright/test'

// ─── B-onboarding: Presets de fidelización ─────────────────────────────────────
// Aplica el combo "Programa recomendado" y verifica que siembre config + canje, y
// que re-aplicar sea idempotente (no duplica el canje). Contra el stack real (bypass).

const E2E_SECRET = process.env.PLAYWRIGHT_E2E_AUTH_SECRET || 'e2e-secret-local'
const E2E_OWNER_EMAIL = process.env.PLAYWRIGHT_E2E_OWNER_EMAIL || 'owner@mimosnails.com'

function setOwnerAuth(page: Page) {
  page.setExtraHTTPHeaders({ 'x-e2e-test-user-email': E2E_OWNER_EMAIL, 'x-e2e-auth-secret': E2E_SECRET })
}

async function gotoStable(page: Page, path: string, attempts = 4): Promise<void> {
  for (let i = 0; i < attempts; i++) {
    try {
      await page.goto(path, { waitUntil: 'domcontentloaded', timeout: 30_000 })
      return
    } catch (e) {
      const msg = String(e)
      if (i < attempts - 1 && /ERR_CONNECTION_REFUSED|ERR_CONNECTION_RESET|Timeout/i.test(msg)) {
        await page.waitForTimeout(1_500); continue
      }
      throw e
    }
  }
}

async function waitForHydration(page: Page): Promise<void> {
  await page.waitForLoadState('load', { timeout: 30_000 }).catch(() => {})
  await page.waitForTimeout(800)
}

/** Card del picker cuyo título coincide con `name`. */
function presetCard(page: Page, name: string) {
  return page.locator('div.rounded-lg.border', { hasText: name }).first()
}

test.describe('Presets de fidelización', () => {
  test('aplicar "Programa recomendado" siembra config + canje, idempotente', async ({ page }) => {
    setOwnerAuth(page)
    await gotoStable(page, '/dashboard/fidelizacion')
    await waitForHydration(page)

    // Aplicar el combo.
    const card = presetCard(page, 'Programa recomendado')
    await card.getByRole('button', { name: 'Aplicar' }).click()
    await card.getByRole('button', { name: 'Confirmar' }).click()
    await expect(card.getByText(/Se encendió/i)).toBeVisible({ timeout: 15_000 })

    // La página revalida: recargar y esperar hidratación antes de leer inputs condicionales.
    await gotoStable(page, '/dashboard/fidelizacion')
    await waitForHydration(page)

    // Config: pointsLabel = sellos, pointsPerVisit = 1 (con reintento por timing de revalidación).
    await expect(async () => {
      const label = await page.locator('#pointsLabel-choice').inputValue()
      expect(label).toBe('sellos')
      const perVisit = await page.locator('input[name="pointsPerVisit"]').inputValue()
      expect(perVisit).toBe('1')
    }).toPass({ timeout: 15_000 })

    // Canje "Servicio gratis" presente exactamente una vez.
    await expect(page.getByText('Servicio gratis', { exact: false })).toHaveCount(1)

    // Regla de Cumpleaños activa (su checkbox quedó marcado).
    const bdayCard = page.locator('form', { hasText: 'Cumpleaños' }).first()
    await expect(bdayCard.locator('input[name="isActive"]')).toBeChecked()

    // Re-aplicar → idempotente: sigue habiendo un solo "Servicio gratis".
    const card2 = presetCard(page, 'Programa recomendado')
    await card2.getByRole('button', { name: 'Aplicar' }).click()
    await card2.getByRole('button', { name: 'Confirmar' }).click()
    await expect(card2.getByText(/Se encendió|Ya tenías/i)).toBeVisible({ timeout: 15_000 })

    await gotoStable(page, '/dashboard/fidelizacion')
    await waitForHydration(page)
    await expect(page.getByText('Servicio gratis', { exact: false })).toHaveCount(1)
  })
})
```

- [ ] **Step 2: Correr el e2e**

Run: `npm run test:e2e -- loyalty-presets`
Expected: 1 test PASS. Si el selector `presetCard` no matchea (por clases distintas del `studio-card`), ajustar el locator al contenedor real de la card (inspeccionar el DOM renderizado); el título de la card es un `<h5>` con el nombre del preset.

- [ ] **Step 3: Gate final — suite + lint + typecheck**

Run: `npm run test` (esperado: toda la suite unit verde)
Run: `npm run lint` (esperado: 0 errores)
Run: `npx tsc --noEmit` (esperado: sin errores)

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/loyalty-presets.spec.ts
git commit -m "test(loyalty): e2e de presets (aplicar combo + idempotencia)"
```

---

## Cierre (después de todas las tasks)

1. **/simplify** sobre el diff de la rama.
2. **Code review experto** (superpowers:requesting-code-review o /code-review high).
3. Confirmar suite unit verde + e2e verde + lint 0 + `tsc` limpio.
4. **Abrir PR** contra `main` (NO mergear hasta OK explícito del usuario). No hay migración que aplicar.
5. Actualizar la memoria `promotions-loyalty-initiative` (rebanada B-onboarding construida).

## Self-Review (checklist del autor del plan)

- **Cobertura del spec:** catálogo (T1) · buildPresetPayload/planPresetApply/summarizeApply/redemptionSignature (T1) · applyLoyaltyPreset con advisory lock + merge de config + reuse de write-paths (T2) · dropdown pointsLabel (T3) · picker agrupado + aviso base-sobre-base + resumen + wire (T4) · e2e idempotente (T5). Sin migración (correcto: spec lo exige). ✔
- **Placeholders:** ninguno; todo el código está completo. ✔
- **Consistencia de tipos:** `CurrentLoyaltyState`, `PresetPlan`, `ApplyPresetSummary`, `redemptionSignature`, `buildPresetPayload`, `planPresetApply`, `summarizeApply`, `presetCatalog` se definen en T1 y se consumen con las mismas firmas en T2/T4. `AutomaticRuleInput` importado de schema en T2. ✔
