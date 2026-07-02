# Presets de fidelización — Diseño

**Rebanada:** B-onboarding (presets de programas de fidelización). Se monta sobre B1/B2/B3
ya en prod. Índice de la iniciativa: `../2026-06-28-promotions-loyalty-roadmap.md`.
Memoria: `promotions-loyalty-initiative`.

## Problema

El motor de fidelización ya cubre casi todos los arquetipos comunes de un salón (puntos por
visita/gasto, sellos derivables, canje, cumpleaños, referidas, win-back, primera visita,
reseña). Pero **es inusable de arranque**: configurarlo es un formulario largo (config +
6 tarjetas de reglas automáticas + catálogo de canje), todo a mano. Un review lo marcó como
"tan configurable que es tedioso".

## Objetivo

Que una dueña encienda un programa de fidelización **coherente en un clic** y después lo
ajuste, en vez de partir de un formulario en blanco. Presets = capa de onboarding sobre el
motor existente; **sin motor nuevo, sin migración, sin tabla nueva**.

## Decisiones cerradas (del brainstorming)

- **Modelo A — cards de programa "starter"** (estilo Fresha): grilla de programas con nombre;
  "Aplicar" siembra un programa completo; la dueña ajusta en las pantallas actuales.
- **Presets generales para negocios de servicios**, no hardcodeados a uñas. El piloto es una
  manicurista pero el producto no.
- **Base vs add-on:**
  - **Base** (mutuamente excluyentes, definen el "cómo ganan"): setean `LoyaltyConfig`
    (modelo de acumulación) + una opción de canje.
  - **Add-on** (apilables): cada uno = una regla automática con buenos defaults.
  - **Combo** = un base + add-ons, aplicados de una.
- **Aplicar = aditivo + idempotente.** Enciende/actualiza solo lo que el preset define;
  **nunca borra** reglas ni opciones de canje hechas a mano. Re-aplicar no duplica. La única
  sobrescritura es la de los escalares de la fila única `LoyaltyConfig` que definen el modelo
  de acumulación (un negocio corre un solo programa base).
- **Recompensas de add-ons como % del precio** (grant `percentage`), currency-clean y
  universal sin importar la moneda ni el base elegido.
- **Cashback ("puntos por gasto") queda FUERA de v1.** Su default (`spendPerPoint`, monto
  absoluto) depende de la escala de la moneda ("cada $1000 = 1 punto" sirve en CLP, es absurdo
  en USD) y choca con currency-clean. Documentado como adición futura.
- **Guardar presets propios = fast-follow** (no en esta rebanada). "Modificar" = editar los
  registros sembrados en las pantallas actuales.
- **Fix incluido:** `pointsLabel` (nombre de la unidad) pasa de texto libre a **dropdown**
  (puntos/estrellas/sellos/visitas + "otro" custom). `programName` y `cardMessage` siguen
  libres (son nombres/mensajes genuinos).

## Arquitectura

Tres unidades con límites claros:

1. **`src/lib/loyalty/presets.ts`** (nuevo, puro, sin imports de servidor): el catálogo de
   presets como datos + funciones puras. Importable desde RSC y desde el cliente (solo datos
   estáticos, sin secretos). No corre validación en runtime; solo describe y planifica.
2. **`applyLoyaltyPreset(presetId)`** (nueva server action en `loyalty.ts`, async): carga el
   estado actual, llama a la lógica pura de planificación, y ejecuta el plan en una
   transacción. Rate-limited. `await revalidatePath`.
3. **UI** (`preset-picker.tsx` + cambios en `page.tsx` y `loyalty-config-form.tsx`): grilla de
   cards con confirmación en lenguaje natural; dropdown de `pointsLabel`.

### Flujo de datos

Dueña abre `/dashboard/fidelizacion` → ve "Programas recomendados" arriba → clic *Aplicar* en
una card → diálogo de confirmación con el preview en lenguaje natural → `applyLoyaltyPreset`
siembra (aditivo) en las tablas existentes → las pantallas de config/reglas/canje (B1/B2/B3)
ya muestran lo sembrado → la dueña ajusta a gusto.

## `presets.ts` — tipos y catálogo

```ts
import type { AutomaticRuleFormInput, RedemptionOptionFormInput } from './schema'

export type PresetKind = 'base' | 'addon' | 'combo'

/** Escalares del modelo de acumulación que un preset base setea sobre LoyaltyConfig.
 *  Solo estos campos se pisan al aplicar; el resto de la config se preserva. */
export type EarnModelPatch = {
  pointsLabel: string
  pointsPerVisit: number
  spendPerPoint: number | null
  minSpendToEarn: number | null
}

export type LoyaltyPreset = {
  id: string                 // slug estable, p.ej. 'stamp-card'
  kind: PresetKind
  name: string               // display
  recommended?: boolean
  describe: string[]         // preview en lenguaje natural (una línea por frase)
  config?: EarnModelPatch                 // solo base
  redemptionOptions?: RedemptionOptionFormInput[]  // solo base
  rules?: AutomaticRuleFormInput[]        // solo add-on
  componentIds?: string[]    // solo combo: ids de base + add-ons a componer
}

/** Payload plano que un preset produce, listo para sembrar. */
export type PresetPayload = {
  config: EarnModelPatch | null
  redemptionOptions: RedemptionOptionFormInput[]
  rules: AutomaticRuleFormInput[]
}
```

### Catálogo (v1)

**Bases:**

- `stamp-card` — **Tarjeta de sellos** (recommended)
  - config: `{ pointsLabel: 'sellos', pointsPerVisit: 1, spendPerPoint: null, minSpendToEarn: null }`
  - canje: `{ name: 'Servicio gratis', rewardType: 'free_service', rewardValue: 0, pointsCost: 10, appliesToAll: true, isActive: true }`
  - describe: `['Tus clientas ganan 1 sello por visita.', 'A los 10 sellos, un servicio gratis.']`
- `points-per-visit` — **Puntos por visita**
  - config: `{ pointsLabel: 'puntos', pointsPerVisit: 10, spendPerPoint: null, minSpendToEarn: null }`
  - canje: `{ name: '20% de descuento', rewardType: 'percentage', rewardValue: 20, pointsCost: 100, appliesToAll: true, isActive: true }`
  - describe: `['Ganan 10 puntos por visita.', 'Con 100 puntos, 20% de descuento.']`

**Add-ons** (todos `rewardKind: 'grant'`, `rewardType: 'percentage'`, `appliesToAll: true`):

- `birthday` — **Cumpleaños** (recommended)
  - rule: `{ kind: 'birthday', isActive: true, priority: 10, rewardValue: 20, windowDays: 30, grantExpiryDays: 30, maxPerCustomer: 1 }`
  - describe: `['En su mes de cumpleaños, 20% de descuento.', 'Válido 30 días.']`
- `referral` — **Refiere una amiga** (recommended)
  - rule: `{ kind: 'referral', isActive: true, priority: 10, rewardValue: 20, grantExpiryDays: 60, beneficiary: 'both' }`
  - describe: `['Cuando una clienta refiere a alguien nuevo, ambas reciben 20% de descuento.', 'Se premia al completar la primera visita de la referida.']`
- `winback` — **Reactivar inactivas**
  - rule: `{ kind: 'winback', isActive: true, priority: 5, rewardValue: 15, inactivityDays: 90, grantExpiryDays: 21 }`
  - describe: `['A quien no vuelve en 90 días, 15% para reactivarla.', 'Válido 3 semanas.']`
- `first-visit` — **Primera visita**
  - rule: `{ kind: 'first_visit', isActive: true, priority: 5, rewardValue: 15, grantExpiryDays: 45 }`
  - describe: `['En su primera visita completada, 15% para la próxima.']`
- `review` — **Premiá las reseñas**
  - rule: `{ kind: 'review', isActive: true, priority: 5, rewardValue: 10, grantExpiryDays: 45 }`
  - describe: `['Cuando deja una reseña, 10% de descuento.']`

Los campos por-kind no aplicables se omiten (el zod los llena con default). `anniversary`
existe en el motor pero se deja fuera del catálogo v1 (poco común; disponible en config manual).

**Combo:**

- `recommended-program` — **Programa recomendado** (recommended)
  - componentIds: `['stamp-card', 'birthday', 'referral']`
  - describe: se ensambla de los componentes.

### Funciones puras

```ts
/** Aplana un preset a su payload sembrable. Para combo, mergea componentes:
 *  toma el config del único base, concatena redemptionOptions y rules, sin kinds duplicados. */
export function buildPresetPayload(presetId: string): PresetPayload

/** Metadata de display para el cliente (sin exponer payload completo si no hace falta). */
export function presetCatalog(): Array<Pick<LoyaltyPreset, 'id'|'kind'|'name'|'recommended'|'describe'>>

/** Estado actual relevante para decidir qué sembrar (aditivo). */
export type CurrentLoyaltyState = {
  config: EarnModelPatch & { programName: string | null } | null
  existingRuleKinds: string[]            // kinds de reglas automatic ya presentes (activas o no)
  existingRedemptionSignatures: string[] // `${rewardType}:${rewardValue}:${pointsCost}` activas
}

export type PresetPlan = {
  configToWrite: (EarnModelPatch & { isActive: true; programName: string }) | null
  rulesToCreate: AutomaticRuleFormInput[]
  redemptionsToCreate: RedemptionOptionFormInput[]
  skipped: { rules: string[]; redemptions: string[] }  // para el resumen
}

/** Decide, de forma aditiva e idempotente, qué del payload se siembra dado el estado actual. */
export function planPresetApply(payload: PresetPayload, state: CurrentLoyaltyState): PresetPlan
```

**Semántica de `planPresetApply`:**

- **config:** si el payload trae `config` (base/combo), merge sobre `state.config`:
  - pisa `pointsLabel`, `pointsPerVisit`, `spendPerPoint`, `minSpendToEarn`;
  - `isActive: true` siempre (aplicar enciende el programa);
  - `programName`: preserva el actual si existe y no está vacío; si no, default `'Programa de fidelidad'`.
  - Si el payload no trae config (preset add-on suelto), `configToWrite: null`.
- **rules:** por cada rule del payload cuyo `kind` **no** esté en `state.existingRuleKinds`,
  incluir en `rulesToCreate`; los kinds ya presentes van a `skipped.rules` (no se tocan).
- **redemptions:** por cada opción del payload cuya firma
  `${rewardType}:${rewardValue}:${pointsCost}` **no** esté en `state.existingRedemptionSignatures`,
  incluir; las equivalentes van a `skipped.redemptions`.

Idempotencia: re-aplicar con el estado ya sembrado ⇒ `rulesToCreate` y `redemptionsToCreate`
vacíos; `configToWrite` reproduce el mismo merge (no cambia nada).

## `applyLoyaltyPreset` — server action

```ts
export async function applyLoyaltyPreset(presetId: unknown): Promise<void>
```

1. `requireBusinessRole(['owner','admin'])`.
2. `checkRateLimit('loyalty-preset', 30, 60000, { userId, businessId })`.
3. Validar `presetId` contra los ids del catálogo (`buildPresetPayload` lanza si no existe).
4. Cargar `CurrentLoyaltyState`:
   - `loyaltyConfig.findUnique` (earn scalars + programName);
   - `promotion.findMany(automaticRuleWhere)` → derivar kinds vía `conditionKind`;
   - `promotion.findMany(redemptionOptionWhere + isActive)` → firmas.
5. `plan = planPresetApply(buildPresetPayload(presetId), state)`.
6. Ejecutar en **una** `prisma.$transaction(async tx => { ... })`:
   - si `plan.configToWrite`: `tx.loyaltyConfig.upsert` con el objeto completo mergeado
     (validado antes con `loyaltyConfigSchema` para reusar defaults de los toggles/labels
     ausentes; ver nota);
   - crear cada rule de `plan.rulesToCreate`: validar con `automaticRuleSchema`, luego
     `tx.promotion.create({ triggerType: 'automatic', ..., conditions: buildConditions(d) })`;
   - crear cada redemption de `plan.redemptionsToCreate`: validar con `redemptionOptionSchema`,
     luego `tx.promotion.create({ triggerType: 'granted', ... })`.
   - Todos los presets usan `appliesToAll: true` ⇒ sin `serviceIds`, sin validación de servicios.
7. `await revalidatePath('/dashboard/fidelizacion')`.

**Nota (evitar duplicar lógica):** la creación de una regla automática desde un
`AutomaticRuleInput` validado se extrae a un helper module-local **no exportado**
(`createAutomaticRuleRecord(tx, businessId, userId, input)`) que comparten `upsertAutomaticRule`
y `applyLoyaltyPreset`. Igual para la opción de canje si conviene. (Módulo `'use server'`:
solo se exportan funciones async; los helpers module-local son válidos.)

**Merge de config:** para respetar `loyaltyConfigSchema` (que exige `programName` y aplica
defaults de toggles), el action construye el objeto completo de config = `{ ...actual,
...configToWrite }` con los campos no-earn preservados (`cardMessage`, `grantExpiryDays`,
`refundPointsOnExpiry`, `forfeitGrantOnNoShow`, `clawbackAutoRewardOnRefund`), lo valida con
`loyaltyConfigSchema`, y hace `upsert`. Así un negocio sin config previa arranca con defaults
sanos y uno con config conserva sus toggles.

## UI

### `preset-picker.tsx` (nuevo, client)

- Sección "Programas recomendados" con grilla de cards.
- Orden: combo recommended primero, luego bases, luego add-ons. Badge **"Recomendado"** en
  los `recommended`.
- Cada card: nombre, `describe` (lenguaje natural), botón *Aplicar*.
- Al hacer *Aplicar*: diálogo de confirmación mostrando `describe` + la línea fija
  "Se aplicará sobre tu programa actual sin borrar lo que ya configuraste." → confirmar llama
  `applyLoyaltyPreset(id)` en `useTransition` → al terminar, mensaje "Aplicado" (la página
  revalida y las pantallas de abajo reflejan lo sembrado).
- Errores: mostrar el `message` de la action.

### `page.tsx` (modificar)

Renderizar `<PresetPicker presets={presetCatalog()} />` arriba de las secciones actuales de
config/reglas/canje. No necesita el estado actual (el action lo recomputa).

### `loyalty-config-form.tsx` (modificar)

`pointsLabel` pasa de `<Input>` a un `<select>` con opciones
`['puntos','estrellas','sellos','visitas']` + `'otro'`; al elegir "otro" se revela un
`<Input>` de texto. El valor enviado sigue siendo `pointsLabel` (string). Server/schema sin
cambios. Si el valor actual no está entre las opciones, se preselecciona "otro" con el texto.

## Testing

### Unit — `tests/unit/loyalty-presets.test.ts`

1. **Integridad del catálogo:** para cada preset, `buildPresetPayload(id)` produce:
   - config (si base/combo) que, mergeada con un `programName` dummy, valida contra
     `loyaltyConfigSchema`;
   - cada redemption valida contra `redemptionOptionSchema`;
   - cada rule valida contra `automaticRuleSchema`.
2. **Combo:** `recommended-program` aplana a config del base + rules de sus add-ons, sin kinds
   duplicados, con exactamente un config.
3. **`planPresetApply` aditivo/idempotente:**
   - estado limpio → escribe config, crea todas las rules y la redemption;
   - estado con una rule del mismo kind → ese kind en `skipped.rules`, los demás creados;
   - estado con redemption de firma equivalente → en `skipped.redemptions`;
   - estado con config previa → merge pisa earn scalars, preserva `programName`, `isActive:true`;
   - re-aplicar (estado = post-primera-aplicación) → `rulesToCreate` y `redemptionsToCreate`
     vacíos.

### e2e — `tests/e2e/loyalty-presets.spec.ts`

Contra el stack real (bypass de header, negocio `mimosnails`):

1. Ir a `/dashboard/fidelizacion` → ver "Programas recomendados".
2. Aplicar "Programa recomendado" → confirmar.
3. Aserciones (con espera de hidratación + reintento donde el input dependa de estado):
   - form de config: `pointsLabel` = "sellos", `pointsPerVisit` = 1;
   - existe una opción de canje "Servicio gratis";
   - las reglas de Cumpleaños y Referidas quedan activas.
4. Aplicar el mismo preset otra vez → **no** aparece una segunda opción de canje "Servicio
   gratis" (idempotencia).

## Archivos

- **Crear:** `src/lib/loyalty/presets.ts`
- **Modificar:** `src/server/actions/loyalty.ts` (+`applyLoyaltyPreset`, +helper module-local)
- **Crear:** `src/app/dashboard/fidelizacion/preset-picker.tsx`
- **Modificar:** `src/app/dashboard/fidelizacion/page.tsx` (render picker)
- **Modificar:** `src/app/dashboard/fidelizacion/loyalty-config-form.tsx` (dropdown pointsLabel)
- **Crear:** `tests/unit/loyalty-presets.test.ts`
- **Crear:** `tests/e2e/loyalty-presets.spec.ts`
- **Sin cambios en** `prisma/schema.prisma`. **Sin migración.**

## Reglas de repo (recordatorio para el build)

- Módulos `'use server'` exportan **solo** funciones async; helpers module-local van sin export.
- Todo `revalidate*` con `await`.
- Currency-clean: `formatMoney`, recompensas como % del precio; nada de moneda hardcodeada.
- Mantener la suite verde. `presets.ts` sin imports de servidor (lo importa el cliente).
- No mergear hasta OK explícito; PR al final. No hay migración que aplicar en esta rebanada.

## Fuera de alcance (fast-follow / futuras rebanadas)

- Guardar/reusar presets propios (tabla + migración) → encaja con E (multisite).
- Cashback "puntos por gasto" (default currency-sensible).
- Niveles/tiers y membresía paga (requieren motor nuevo) → rebanadas propias.
- Preset de paquetes prepagados → se suma cuando exista B4.
