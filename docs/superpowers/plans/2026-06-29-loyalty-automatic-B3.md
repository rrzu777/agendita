# B3 — Condiciones automáticas (fidelización) · Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reglas de fidelización automáticas (cumpleaños, aniversario, win-back, primera visita, reseña→premio, referidas) que emiten un grant reusable o puntos directos, evaluadas server-side por eventos del negocio o por un barrido diario del cron.

**Architecture:** Una regla = `Promotion(triggerType='automatic')` + `conditions` JSON. Emite por las primitivas de B1 (ledger) y B2 (`PromotionGrant`). Eventos enganchan en `updateBookingStatus`/`submitReview`/`createBooking`; lo temporal corre en `src/lib/cron/loyalty-automatic.ts` (mismo molde que `send-reminders`). Idempotencia uniforme: grants por `(customerId, requestId)`, puntos por `(businessId, dedupeKey)`; el barrido temporal dedup por ocasión `(clienta, día)` con prioridad configurable.

**Tech Stack:** Next.js 16 (App Router, server actions), Prisma 5.22 + Postgres, Zod 4.4.3, date-fns-tz, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-06-29-loyalty-automatic-B3-design.md`

**Reglas de repo (no negociables):**
- Módulos `'use server'` exportan **solo** funciones async (nada de consts/objetos exportados).
- Todo `revalidate*` **con `await`**.
- Currency-clean (`formatMoney`), nada de `es-CL` hardcodeado nuevo.
- Migración a la DB **solo con confirmación explícita del usuario**; nunca prod sin OK.
- Al generar migración con `prisma migrate diff --script > file`: **borrar la línea 1 si trae** `zsh: command not found: _nvm_load` (ruido del shell; rompió db execute en B2).
- e2e por **header bypass** (`x-e2e-test-user-email` + `x-e2e-auth-secret`, `ENABLE_E2E_AUTH_BYPASS=true`), env vía `npx dotenvx run -f .env.local`. Sin tipear contraseñas.

**Comandos base:**
- Unit test puntual: `npx vitest run tests/unit/<file>.test.ts`
- Suite unit completa: `npm test`
- Lint: `npm run lint`

---

## ⚠️ Correcciones obligatorias de la revisión adversarial (aplican sobre las tasks)

Estas correcciones surgieron de una revisión profunda y **anulan/ajustan** lo que diga el cuerpo
de cada task. Leerlas antes de implementar la task referida.

- **[R-EMIT] (T9, T10) — emitir FUERA de la tx del evento.** En Postgres un P2002 aborta toda la
  `$transaction` y atraparlo en JS no la recupera (Prisma 5.22 no usa SAVEPOINT por query). **NO**
  encadenar `creditVisitPoints` + first_visit + referral con `try/catch P2002` en una sola tx. La
  tx del evento hace su trabajo y commitea; **cada emisión automática corre en su propia
  `prisma.$transaction` post-commit** (como el cron). En `updateBookingStatus`: la tx principal
  hace flip + marcas (`firstCompletedAt`/`lastCompletedAt`) + `creditVisitPoints` y devuelve
  `{ customerId, isFirstVisit }`; después, ya fuera de la tx, se corren first_visit y referral en
  txns separadas. En `submitReview`: crear la review (con su P2002 propio) y **luego**, en tx
  aparte, emitir el premio.
- **[R-TOKEN] (T1, T14, T16) — token de referido separado.** `Customer.referralToken String? @unique`
  distinto del `loyaltyToken`. Helper lazy nuevo `ensureReferralToken(db, customer)` (molde de
  `ensureLoyaltyToken`). El `?ref` resuelve por `referralToken`, no por `loyaltyToken`.
- **[R-WINBACK] (T7) — guard de cooldown correcto.** Excluir winback para una clienta si existe
  emisión suya posterior a `lastCompletedAt`: ledger `bonus` con `sourcePromotionId=<winbackRuleId>`
  **o** `PromotionGrant` con `promotionId=<winbackRuleId>` y `createdAt > lastCompletedAt`; respetar
  `cooldownDays`. Precargar ambos sets por negocio. Mirar solo el ledger re-emite grants a diario.
- **[R-CAP] (T2, T4) — `maxPerCustomer` en los 6 kinds.** Reusar `Promotion.maxPerCustomer`.
  Agregar `maxPerCustomer: optPositiveInt` a `automaticRuleSchema` y persistirlo. En
  `emitAutomaticReward`, antes de emitir, si `rule.maxPerCustomer != null` contar emisiones previas
  de esa regla a esa clienta (ledger `sourcePromotionId=rule.id` + grants `promotionId=rule.id`); si
  `>= maxPerCustomer` ⇒ devolver null (no emitir).
- **[R-PHONE] (T11) — normalizar teléfono en `createBooking` público.** Usar `normalizePhone`
  (el mismo que usa `createBookingFromDashboard`) antes de match/create de la clienta y antes de
  `captureReferral`. Bug preexistente que B3 amplifica.
- **[R-BACKFILL] (T1) — backfill en la migración.** Tras agregar las columnas, `UPDATE "Customer"`
  con `firstCompletedAt`/`lastCompletedAt` = min/max `startDateTime` de `Booking` completadas.
- **[R-CLAWBACK] (T12) — solo refund.** No cablear cancel/no_show (la reserva gatillante está
  `completed`, estado terminal). Solo el webhook MP `refunded`. `reverseAutoRewardsForBooking`
  recibe y filtra por `businessId`.
- **[R-INDEX] (T1, T4, T5) — columnas reales, no JSON.** `LoyaltyLedger` +`triggeringBookingId`
  (índice) +`sourcePromotionId` (índice con businessId); `PromotionGrant` +`triggeringBookingId`
  (índice). `emitAutomaticReward` setea estas columnas (no solo metadata); clawback y guard de
  winback filtran por columna + `businessId` (sin `metadata:{path}`).
- **[R-NAMES] (T7-nota, T14, T16) — nombres/rutas reales.** Token lazy de tarjeta =
  `ensureLoyaltyToken` (NO `resolveOrCreateToken`). URL pública = `getBusinessPublicUrl(business, path)`
  de `@/lib/business/urls`. Funnel = `src/app/book/[slug]/page.tsx` + `src/app/book/page.tsx`
  (subdominio) + wizard `src/components/booking/step-payment.tsx` (llama `createBooking` ~líneas
  215/249). Ambas pages deben leer `searchParams.ref` y pasarlo por el wizard; `createBooking`
  schema suma `referralToken`.
- **[R-MIGRATE] (T1, T17) — DIRECT_URL + db execute.** `migrate diff` y `db execute` contra
  `DIRECT_URL` (no el pooler). Aplicar con `db execute` del `.sql`, **nunca** `migrate deploy`.
- **[R-GUARD] (T-apply) — defensa en `apply.ts`.** En la rama grant de `applyPromotionInTx`,
  antes de `computeDiscount`, `if (p.rewardType == null) throw new Error('Recompensa inválida')`
  (una regla de puntos nunca emite grant, pero es barato).
- **[R-TEST] (T10) — mocks.** `tests/unit/reviews-actions.test.ts` mockea `review.create` directo;
  al envolver en `$transaction` hay que mockear `prisma.$transaction` (callback con `tx.review.create`,
  `tx.loyaltyConfig.findUnique→null`, `tx.promotion.findMany→[]`).

---

## Mapa de archivos

**Crear:**
- `src/lib/loyalty/automatic-match.ts` — matchers puros (birthday/anniversary/winback), TZ, dedupe/occasion keys, orden por prioridad.
- `src/lib/loyalty/automatic.ts` — `emitAutomaticReward` (emisor compartido puntos|grant) + `reverseAutoRewardsForBooking` (clawback).
- `src/lib/loyalty/referral.ts` — `captureReferral` + `rewardReferralOnCompletion`.
- `src/lib/cron/loyalty-automatic.ts` — `runAutomaticLoyalty(now)`.
- `src/app/api/cron/loyalty-automatic/route.ts` — endpoint Bearer.
- `src/lib/notifications/loyalty-reward.ts` (o extender `notifications`) — email transaccional de recompensa.
- `src/app/dashboard/fidelizacion/automatic-rules.tsx` — UI de reglas automáticas.
- Tests: `tests/unit/loyalty-automatic-match.test.ts`, `tests/unit/loyalty-automatic-emit.test.ts`, `tests/unit/loyalty-referral.test.ts`, `tests/unit/loyalty-automatic-cron.test.ts`, `tests/unit/loyalty-automatic-schema.test.ts`.

**Modificar:**
- `prisma/schema.prisma` (+ migración).
- `src/lib/loyalty/schema.ts` — `automaticRuleSchema` + `automaticConditionsSchema`.
- `src/lib/loyalty/view.ts` — labels `bonus`/`bonus_reversal`.
- `src/server/actions/bookings.ts` — wiring completion (first_visit + referral + firstCompletedAt/lastCompletedAt) y captura de referral.
- `src/server/actions/reviews.ts` — wiring review→premio.
- `src/server/actions/promotions.ts` — `listPromotions` filtra `triggerType: 'code'`.
- `src/server/actions/loyalty.ts` — CRUD reglas automáticas + link de referido.
- `src/app/api/webhooks/mercado-pago/route.ts` — clawback gated.
- `src/app/dashboard/fidelizacion/page.tsx` + `loyalty-config-form.tsx` — sección reglas + toggle clawback.
- `src/app/tarjeta/[token]/page.tsx` — "Referí a una amiga".
- `src/app/[business]/...` página pública de reserva — captura `?ref=`.
- `.github/workflows/cron.yml` — step del nuevo cron.

---

## Task 1: Schema Prisma + migración aditiva

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_add_automatic_loyalty/migration.sql`

- [ ] **Step 1: Editar `prisma/schema.prisma`**

Enums — agregar valores a `LoyaltyReason` y crear `ReferralStatus`:

```prisma
enum LoyaltyReason {
  visit
  visit_reversal
  adjustment
  redemption
  redemption_reversal
  bonus
  bonus_reversal
}

enum ReferralStatus {
  pending
  rewarded
  void
}
```

En `model Promotion` agregar (junto a `pointsCost`/`grantExpiryDays`; `maxPerCustomer` ya existe y se reusa):

```prisma
  rewardPoints    Int?
  priority        Int              @default(0)
```

En `model LoyaltyLedger` agregar los campos, el unique y los índices (R-INDEX):

```prisma
  dedupeKey         String?
  triggeringBookingId String?
  sourcePromotionId String?
```
y en la zona de índices del modelo:
```prisma
  @@unique([businessId, dedupeKey])
  @@index([triggeringBookingId])
  @@index([businessId, sourcePromotionId])
```

En `model PromotionGrant` agregar (R-INDEX, para el clawback):
```prisma
  triggeringBookingId String?
```
y en sus índices:
```prisma
  @@index([triggeringBookingId])
```

En `model LoyaltyConfig` agregar:
```prisma
  clawbackAutoRewardOnRefund Boolean @default(false)
```

En `model Customer` agregar campos + relación (R-TOKEN: `referralToken` separado del `loyaltyToken`):
```prisma
  firstCompletedAt DateTime?
  lastCompletedAt  DateTime?
  referralToken    String?   @unique

  referralsMade     Referral[] @relation("ReferralReferrer")
  referralReceived  Referral?  @relation("ReferralReferred")
```

Nuevo modelo `Referral`:
```prisma
model Referral {
  id                  String         @id @default(cuid())
  businessId          String
  referrerCustomerId  String
  referredCustomerId  String         @unique
  status              ReferralStatus @default(pending)
  triggeringBookingId String?
  rewardedAt          DateTime?
  createdAt           DateTime       @default(now())

  business Business @relation(fields: [businessId], references: [id], onDelete: Cascade)
  referrer Customer @relation("ReferralReferrer", fields: [referrerCustomerId], references: [id], onDelete: Cascade)
  referred Customer @relation("ReferralReferred", fields: [referredCustomerId], references: [id], onDelete: Cascade)

  @@index([businessId, status])
  @@index([referrerCustomerId])
}
```

Agregar `referrals Referral[]` a `model Business` (en la lista de relaciones).

> **Nota (superset menor del spec):** se agrega también `Customer.lastCompletedAt` para que el win-back del cron no tenga que agregar `max(startDateTime)` por clienta en cada corrida.

- [ ] **Step 2: Generar el cliente Prisma y la migración SQL**

```bash
npx prisma generate
npx prisma migrate diff \
  --from-schema-datasource prisma/schema.prisma \
  --to-schema-datamodel prisma/schema.prisma \
  --script > /tmp/b3.sql 2>/dev/null || true
```
> Generar el `.sql` real con el flujo que ya usó B2 (`migrate diff` contra el estado de la DB). **Revisar la primera línea** del `.sql`: si dice `zsh: command not found: _nvm_load`, borrarla (`sed -i '' '1d' <file>`). El archivo final va en `prisma/migrations/<timestamp>_add_automatic_loyalty/migration.sql` y debe contener: `ALTER TYPE "LoyaltyReason" ADD VALUE 'bonus'`/`'bonus_reversal'`; `CREATE TYPE "ReferralStatus"`; `ALTER TABLE "Promotion" ADD COLUMN "rewardPoints"`, `"priority"`; `ALTER TABLE "LoyaltyLedger" ADD COLUMN "dedupeKey"` + índice unique `("businessId","dedupeKey")`; `ALTER TABLE "LoyaltyConfig" ADD COLUMN "clawbackAutoRewardOnRefund"`; `ALTER TABLE "Customer" ADD COLUMN "firstCompletedAt"`, `"lastCompletedAt"`; `CREATE TABLE "Referral"` + índices + FKs.

> **`ADD VALUE` de enum** no corre dentro de una transacción en Postgres. Si la migración falla por eso, separar los `ALTER TYPE ... ADD VALUE` en su propia sentencia sin envolver en `BEGIN/COMMIT` (db execute los corre sueltos). **Generar `migrate diff` y aplicar `db execute` contra `DIRECT_URL`, no el pooler** (R-MIGRATE).

- [ ] **Step 2b: Agregar el backfill al final del `.sql`** (R-BACKFILL) — para que aniversario/win-back funcionen con la base actual:

```sql
UPDATE "Customer" c SET
  "firstCompletedAt" = sub.min_dt,
  "lastCompletedAt"  = sub.max_dt
FROM (
  SELECT "customerId", MIN("startDateTime") AS min_dt, MAX("startDateTime") AS max_dt
  FROM "Booking" WHERE "status" = 'completed' AND "customerId" IS NOT NULL
  GROUP BY "customerId"
) sub
WHERE c."id" = sub."customerId";
```

- [ ] **Step 3: NO aplicar a la DB todavía.** La aplicación queda para Task 17 con confirmación explícita del usuario. Verificar solo que el cliente compila:

```bash
npx tsc --noEmit -p tsconfig.json 2>&1 | head -20
```
Expected: sin errores nuevos por los modelos (los call-sites nuevos aún no existen).

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(loyalty): schema B3 — reglas automáticas + Referral (migración aditiva)"
```

---

## Task 2: Zod schema de reglas automáticas + labels de vista

**Files:**
- Modify: `src/lib/loyalty/schema.ts`
- Modify: `src/lib/loyalty/view.ts`
- Test: `tests/unit/loyalty-automatic-schema.test.ts`

- [ ] **Step 1: Test fallando** — `tests/unit/loyalty-automatic-schema.test.ts`

```ts
import { describe, it, expect } from 'vitest'
import { automaticRuleSchema, AUTOMATIC_KINDS } from '@/lib/loyalty/schema'

const base = { kind: 'birthday', isActive: true, priority: 0,
  rewardKind: 'points', rewardPoints: 100,
  rewardType: 'percentage', rewardValue: 0, maxDiscount: null, appliesToAll: true, serviceIds: [],
  grantExpiryDays: null, windowDays: 7, inactivityDays: 90, cooldownDays: 180, beneficiary: 'both' }

describe('automaticRuleSchema', () => {
  it('expone los 6 kinds', () => {
    expect(AUTOMATIC_KINDS).toEqual(['birthday','first_visit','review','anniversary','winback','referral'])
  })
  it('reward points: exige rewardPoints > 0 y deja la rama grant en null', () => {
    const r = automaticRuleSchema.parse(base)
    expect(r.rewardPoints).toBe(100)
    expect(r.rewardType).toBeNull()
  })
  it('reward grant: exige rewardType/value y deja rewardPoints en null', () => {
    const r = automaticRuleSchema.parse({ ...base, rewardKind: 'grant', rewardPoints: null,
      rewardType: 'percentage', rewardValue: 20 })
    expect(r.rewardPoints).toBeNull()
    expect(r.rewardType).toBe('percentage')
    expect(r.rewardValue).toBe(20)
  })
  it('rechaza porcentaje fuera de 1..100 en rama grant', () => {
    expect(() => automaticRuleSchema.parse({ ...base, rewardKind: 'grant', rewardPoints: null,
      rewardType: 'percentage', rewardValue: 200 })).toThrow()
  })
  it('grant free_service fuerza rewardValue 0', () => {
    const r = automaticRuleSchema.parse({ ...base, rewardKind: 'grant', rewardPoints: null,
      rewardType: 'free_service', rewardValue: 999, appliesToAll: false, serviceIds: ['s1'] })
    expect(r.rewardValue).toBe(0)
  })
  it('winback exige inactivityDays > 0', () => {
    expect(() => automaticRuleSchema.parse({ ...base, kind: 'winback', inactivityDays: 0 })).toThrow()
  })
})
```

- [ ] **Step 2: Verificar que falla**

Run: `npx vitest run tests/unit/loyalty-automatic-schema.test.ts`
Expected: FAIL (`automaticRuleSchema` no existe).

- [ ] **Step 3: Implementar en `src/lib/loyalty/schema.ts`** (agregar al final, reusa `optPositiveInt`/`optText` ya definidos arriba en el archivo)

```ts
export const AUTOMATIC_KINDS = ['birthday','first_visit','review','anniversary','winback','referral'] as const
export type AutomaticKind = (typeof AUTOMATIC_KINDS)[number]

/** Una regla automática define UNA forma de recompensa: puntos directos (rewardKind
 *  'points') o un grant reusable (rewardKind 'grant', con los campos de descuento). */
export const automaticRuleSchema = z.object({
  kind: z.enum(AUTOMATIC_KINDS),
  isActive: z.boolean(),
  priority: z.coerce.number().int().min(0).max(1000).default(0),
  rewardKind: z.enum(['points', 'grant']),
  rewardPoints: z.coerce.number().int().optional().nullable(),
  rewardType: z.enum(['percentage', 'fixed_amount', 'free_service']).optional().nullable(),
  rewardValue: z.coerce.number().int().nonnegative().optional().default(0),
  maxDiscount: optPositiveInt,
  appliesToAll: z.boolean().default(true),
  serviceIds: z.array(z.string().min(1)).optional().default([]),
  grantExpiryDays: optPositiveInt,
  // Parámetros por kind (se ignoran los no aplicables):
  windowDays: z.coerce.number().int().min(0).max(60).optional().default(0),
  inactivityDays: z.coerce.number().int().min(0).max(3650).optional().default(0),
  cooldownDays: z.coerce.number().int().min(0).max(3650).optional().default(0),
  beneficiary: z.enum(['both', 'referrer', 'referred']).optional().default('both'),
}).strip()
  // Normaliza la rama de recompensa elegida y anula la otra.
  .transform((d) => {
    if (d.rewardKind === 'points') {
      return { ...d, rewardType: null, rewardValue: 0, maxDiscount: null,
        rewardPoints: d.rewardPoints && d.rewardPoints > 0 ? d.rewardPoints : null }
    }
    const rewardValue = d.rewardType === 'free_service' ? 0 : d.rewardValue
    return { ...d, rewardPoints: null, rewardValue }
  })
  .refine((d) => d.rewardKind !== 'points' || (d.rewardPoints != null && d.rewardPoints > 0),
    { message: 'Los puntos de la recompensa deben ser mayores a 0', path: ['rewardPoints'] })
  .refine((d) => d.rewardKind !== 'grant' || d.rewardType != null,
    { message: 'Elige el tipo de recompensa', path: ['rewardType'] })
  .refine((d) => d.rewardKind !== 'grant' || d.rewardType !== 'percentage'
      || (d.rewardValue >= 1 && d.rewardValue <= 100),
    { message: 'El porcentaje debe estar entre 1 y 100', path: ['rewardValue'] })
  .refine((d) => d.rewardKind !== 'grant' || d.appliesToAll || d.serviceIds.length > 0,
    { message: 'Elige al menos un servicio o aplica a todos', path: ['serviceIds'] })
  .refine((d) => d.kind !== 'winback' || d.inactivityDays > 0,
    { message: 'La inactividad debe ser mayor a 0 días', path: ['inactivityDays'] })

export type AutomaticRuleInput = z.infer<typeof automaticRuleSchema>
export type AutomaticRuleFormInput = z.input<typeof automaticRuleSchema>

/** Arma el JSON `conditions` que se guarda en la Promotion a partir de la regla validada. */
export function buildConditions(d: AutomaticRuleInput): Record<string, unknown> {
  return { kind: d.kind, windowDays: d.windowDays, inactivityDays: d.inactivityDays,
    cooldownDays: d.cooldownDays, beneficiary: d.beneficiary }
}
```

- [ ] **Step 4: Labels en `src/lib/loyalty/view.ts`** — agregar al `REASON_LABELS`:

```ts
  bonus: 'Bonificación',
  bonus_reversal: 'Reversa de bonificación',
```

- [ ] **Step 5: Verificar verde**

Run: `npx vitest run tests/unit/loyalty-automatic-schema.test.ts`
Expected: PASS (6/6).

- [ ] **Step 6: Commit**

```bash
git add src/lib/loyalty/schema.ts src/lib/loyalty/view.ts tests/unit/loyalty-automatic-schema.test.ts
git commit -m "feat(loyalty): zod de reglas automáticas + labels bonus"
```

---

## Task 3: Matchers puros + dedupe/occasion keys

**Files:**
- Create: `src/lib/loyalty/automatic-match.ts`
- Test: `tests/unit/loyalty-automatic-match.test.ts`

- [ ] **Step 1: Test fallando** — `tests/unit/loyalty-automatic-match.test.ts`

```ts
import { describe, it, expect } from 'vitest'
import {
  matchesBirthday, matchesAnniversary, isWinbackInactive,
  occasionKey, firstVisitKey, reviewKey, referralKey, sortByPriorityDesc,
} from '@/lib/loyalty/automatic-match'

const TZ = 'America/Santiago'
const d = (s: string) => new Date(s)

describe('matchers temporales', () => {
  it('cumpleaños: matchea el día exacto en la TZ del negocio', () => {
    expect(matchesBirthday(d('1990-06-29'), d('2026-06-29T12:00:00Z'), TZ, 0)).toBe(true)
    expect(matchesBirthday(d('1990-06-28'), d('2026-06-29T12:00:00Z'), TZ, 0)).toBe(false)
  })
  it('cumpleaños: respeta la ventana ±windowDays', () => {
    expect(matchesBirthday(d('1990-07-02'), d('2026-06-29T12:00:00Z'), TZ, 7)).toBe(true)
    expect(matchesBirthday(d('1990-07-10'), d('2026-06-29T12:00:00Z'), TZ, 7)).toBe(false)
  })
  it('cumpleaños: null => false', () => {
    expect(matchesBirthday(null, d('2026-06-29T12:00:00Z'), TZ, 7)).toBe(false)
  })
  it('aniversario: usa mes/día de firstCompletedAt', () => {
    expect(matchesAnniversary(d('2025-06-29T10:00:00Z'), d('2026-06-29T12:00:00Z'), TZ, 0)).toBe(true)
    expect(matchesAnniversary(d('2025-06-01T10:00:00Z'), d('2026-06-29T12:00:00Z'), TZ, 0)).toBe(false)
  })
  it('winback: inactiva si la última completada es más vieja que inactivityDays', () => {
    expect(isWinbackInactive(d('2026-01-01T00:00:00Z'), d('2026-06-29T00:00:00Z'), 90)).toBe(true)
    expect(isWinbackInactive(d('2026-06-01T00:00:00Z'), d('2026-06-29T00:00:00Z'), 90)).toBe(false)
    expect(isWinbackInactive(null, d('2026-06-29T00:00:00Z'), 90)).toBe(false)
  })
})

describe('keys', () => {
  it('occasionKey es por (clienta, día local)', () => {
    expect(occasionKey('c1', d('2026-06-29T12:00:00Z'), TZ)).toBe('c1:2026-06-29:auto-timed')
  })
  it('keys de evento', () => {
    expect(firstVisitKey('c1')).toBe('c1:first_visit')
    expect(reviewKey('c1', 'b9')).toBe('c1:review:b9')
    expect(referralKey('c2')).toBe('c2:referral')
  })
  it('sortByPriorityDesc ordena mayor prioridad primero', () => {
    const out = sortByPriorityDesc([{ priority: 1 }, { priority: 5 }, { priority: 3 }] as any)
    expect(out.map((r: any) => r.priority)).toEqual([5, 3, 1])
  })
})
```

- [ ] **Step 2: Verificar que falla**

Run: `npx vitest run tests/unit/loyalty-automatic-match.test.ts`
Expected: FAIL (módulo no existe).

- [ ] **Step 3: Implementar `src/lib/loyalty/automatic-match.ts`**

```ts
import { formatInTimeZone } from 'date-fns-tz'

const DAY_MS = 86_400_000

/** mes/día (1-based) de una fecha en la zona horaria dada. */
function monthDay(date: Date, timeZone: string): { m: number; d: number } {
  const [m, d] = formatInTimeZone(date, timeZone, 'MM-dd').split('-').map(Number)
  return { m, d }
}

/** Distancia mínima en días entre dos (mes,día) ignorando el año (maneja el wrap dic↔ene).
 *  Usa un año no bisiesto de referencia; con windowDays ≤ 60 el error de borde es irrelevante. */
function monthDayDistance(a: { m: number; d: number }, b: { m: number; d: number }): number {
  const ref = (md: { m: number; d: number }) => Date.UTC(2001, md.m - 1, md.d)
  const yr = 365 * DAY_MS
  let diff = Math.abs(ref(a) - ref(b))
  diff = Math.min(diff, yr - diff)
  return Math.round(diff / DAY_MS)
}

export function matchesBirthday(birthDate: Date | null, now: Date, timeZone: string, windowDays: number): boolean {
  if (!birthDate) return false
  return monthDayDistance(monthDay(birthDate, 'UTC'), monthDay(now, timeZone)) <= windowDays
}

export function matchesAnniversary(firstCompletedAt: Date | null, now: Date, timeZone: string, windowDays: number): boolean {
  if (!firstCompletedAt) return false
  // No premiar el mismo año de la primera visita (aniversario = al menos ~1 año después).
  const elapsedDays = (now.getTime() - firstCompletedAt.getTime()) / DAY_MS
  if (elapsedDays < 365 - windowDays) return false
  return monthDayDistance(monthDay(firstCompletedAt, timeZone), monthDay(now, timeZone)) <= windowDays
}

export function isWinbackInactive(lastCompletedAt: Date | null, now: Date, inactivityDays: number): boolean {
  if (!lastCompletedAt) return false
  return now.getTime() - lastCompletedAt.getTime() >= inactivityDays * DAY_MS
}

export function occasionKey(customerId: string, now: Date, timeZone: string): string {
  return `${customerId}:${formatInTimeZone(now, timeZone, 'yyyy-MM-dd')}:auto-timed`
}
export function firstVisitKey(customerId: string): string { return `${customerId}:first_visit` }
export function reviewKey(customerId: string, bookingId: string): string { return `${customerId}:review:${bookingId}` }
export function referralKey(customerId: string): string { return `${customerId}:referral` }

export function sortByPriorityDesc<T extends { priority: number }>(rules: T[]): T[] {
  return [...rules].sort((a, b) => b.priority - a.priority)
}
```

> **Nota TZ:** `birthDate` es `@db.Date` (sin hora) → Prisma lo entrega como medianoche UTC; por eso `matchesBirthday` lee su mes/día en `'UTC'`. `firstCompletedAt`/`now` sí son timestamps reales → se leen en la TZ del negocio.

- [ ] **Step 4: Verificar verde**

Run: `npx vitest run tests/unit/loyalty-automatic-match.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/loyalty/automatic-match.ts tests/unit/loyalty-automatic-match.test.ts
git commit -m "feat(loyalty): matchers puros + dedupe keys de reglas automáticas"
```

---

## Task 4: Emisor compartido `emitAutomaticReward`

**Files:**
- Create: `src/lib/loyalty/automatic.ts`
- Test: `tests/unit/loyalty-automatic-emit.test.ts`

- [ ] **Step 1: Test fallando** — `tests/unit/loyalty-automatic-emit.test.ts`

```ts
import { describe, it, expect, vi } from 'vitest'
import { emitAutomaticReward } from '@/lib/loyalty/automatic'

const cfg = { grantExpiryDays: 90, forfeitGrantOnNoShow: false }

function fakeTx(opts: { ledgerThrows?: boolean } = {}) {
  return {
    loyaltyLedger: {
      create: opts.ledgerThrows
        ? vi.fn().mockRejectedValue({ code: 'P2002' })
        : vi.fn().mockResolvedValue({ id: 'l1' }),
    },
    promotion: { findFirst: vi.fn().mockResolvedValue(null) },
    promotionGrant: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 'g1', code: 'ABC' }),
    },
  } as any
}

const pointsRule = { id: 'r1', businessId: 'b1', conditions: { kind: 'birthday' },
  rewardPoints: 150, rewardType: null, rewardValue: 0, maxDiscount: null,
  appliesToAll: true, grantExpiryDays: null, services: [] }
const grantRule = { ...pointsRule, rewardPoints: null, rewardType: 'percentage', rewardValue: 20 }

describe('emitAutomaticReward', () => {
  it('puntos: inserta un asiento bonus con dedupeKey y triggeringBookingId', async () => {
    const tx = fakeTx()
    const out = await emitAutomaticReward(tx, { rule: pointsRule as any, businessId: 'b1',
      customerId: 'c1', dedupeKey: 'k1', config: cfg, triggeringBookingId: 'bk1', now: new Date('2026-06-29') })
    expect(tx.loyaltyLedger.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ points: 150, reason: 'bonus', dedupeKey: 'k1', bookingId: null }) }))
    expect(out).toEqual({ kind: 'points', points: 150, ledgerId: 'l1' })
  })
  it('puntos: P2002 (ya emitido) => null sin romper', async () => {
    const tx = fakeTx({ ledgerThrows: true })
    const out = await emitAutomaticReward(tx, { rule: pointsRule as any, businessId: 'b1',
      customerId: 'c1', dedupeKey: 'k1', config: cfg, now: new Date('2026-06-29') })
    expect(out).toBeNull()
  })
  it('grant: crea PromotionGrant pointsSpent 0 y refundOnExpiry false', async () => {
    const tx = fakeTx()
    const out = await emitAutomaticReward(tx, { rule: grantRule as any, businessId: 'b1',
      customerId: 'c1', dedupeKey: 'k2', config: cfg, now: new Date('2026-06-29') })
    expect(tx.promotionGrant.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ pointsSpent: 0, refundOnExpiry: false, requestId: 'k2' }) }))
    expect(out).toEqual({ kind: 'grant', grantId: 'g1', code: 'ABC' })
  })
})
```

- [ ] **Step 2: Verificar que falla**

Run: `npx vitest run tests/unit/loyalty-automatic-emit.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar `src/lib/loyalty/automatic.ts`**

```ts
import type { Prisma, PromotionReward } from '@prisma/client'
import { generateGrantCode } from './redeem'
import { isP2002 } from './credit'

type Tx = Prisma.TransactionClient

const DAY_MS = 86_400_000

export interface AutomaticRule {
  id: string
  businessId: string
  conditions: Prisma.JsonValue
  rewardPoints: number | null
  rewardType: PromotionReward | null
  rewardValue: number
  maxDiscount: number | null
  appliesToAll: boolean
  grantExpiryDays: number | null
  priority?: number
  services?: { id: string }[]
}

export interface EmitConfig {
  grantExpiryDays: number | null
  forfeitGrantOnNoShow: boolean
}

export type EmittedReward =
  | { kind: 'points'; points: number; ledgerId: string }
  | { kind: 'grant'; grantId: string; code: string }
  | null // ya emitido (dedup) o regla sin recompensa válida

/** Emite la recompensa de una regla automática (puntos o grant), idempotente.
 *  - puntos: asiento `bonus` con `dedupeKey` (unique businessId+dedupeKey) y
 *    `metadata.triggeringBookingId` para el clawback. `bookingId` queda null.
 *  - grant: PromotionGrant ganado (pointsSpent 0, refundOnExpiry false), `requestId = dedupeKey`.
 *  Devuelve null si ya estaba emitido (P2002) o si la regla no define recompensa. */
export async function emitAutomaticReward(tx: Tx, args: {
  rule: AutomaticRule
  businessId: string
  customerId: string
  dedupeKey: string
  config: EmitConfig
  triggeringBookingId?: string | null
  now: Date
}): Promise<EmittedReward> {
  const { rule, businessId, customerId, dedupeKey, config, now } = args
  const triggeringBookingId = args.triggeringBookingId ?? null
  const kind = (rule.conditions as { kind?: string } | null)?.kind ?? 'unknown'
  const meta = { ruleId: rule.id, kind, triggeringBookingId, auto: true } as Prisma.InputJsonValue

  // Rama puntos
  if (rule.rewardPoints != null) {
    try {
      const led = await tx.loyaltyLedger.create({
        data: { businessId, customerId, points: rule.rewardPoints, reason: 'bonus',
          bookingId: null, dedupeKey, metadata: meta },
      })
      return { kind: 'points', points: rule.rewardPoints, ledgerId: led.id }
    } catch (e) {
      if (isP2002(e)) return null
      throw e
    }
  }

  // Rama grant
  if (rule.rewardType == null) return null
  const expiryDays = rule.grantExpiryDays ?? config.grantExpiryDays
  const expiresAt = expiryDays != null ? new Date(now.getTime() + expiryDays * DAY_MS) : null
  try {
    const code = await generateGrantCode(tx, businessId)
    const grant = await tx.promotionGrant.create({
      data: { businessId, promotionId: rule.id, customerId, code, pointsSpent: 0,
        status: 'active', expiresAt, refundOnExpiry: false,
        forfeitOnNoShow: config.forfeitGrantOnNoShow, requestId: dedupeKey, metadata: meta },
    })
    return { kind: 'grant', grantId: grant.id, code: grant.code }
  } catch (e) {
    if (isP2002(e)) return null
    throw e
  }
}
```

- [ ] **Step 4: Verificar verde**

Run: `npx vitest run tests/unit/loyalty-automatic-emit.test.ts`
Expected: PASS (3/3).

- [ ] **Step 5: Commit**

```bash
git add src/lib/loyalty/automatic.ts tests/unit/loyalty-automatic-emit.test.ts
git commit -m "feat(loyalty): emitAutomaticReward (puntos|grant, idempotente)"
```

---

## Task 5: Clawback `reverseAutoRewardsForBooking`

**Files:**
- Modify: `src/lib/loyalty/automatic.ts`
- Test: `tests/unit/loyalty-automatic-emit.test.ts` (extender)

- [ ] **Step 1: Test fallando** — agregar a `tests/unit/loyalty-automatic-emit.test.ts`

```ts
import { reverseAutoRewardsForBooking } from '@/lib/loyalty/automatic'

describe('reverseAutoRewardsForBooking', () => {
  function clawbackTx(bonuses: any[], grants: any[]) {
    return {
      loyaltyLedger: {
        findMany: vi.fn().mockResolvedValue(bonuses),
        create: vi.fn().mockResolvedValue({ id: 'rev' }),
      },
      promotionGrant: {
        findMany: vi.fn().mockResolvedValue(grants),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    } as any
  }
  it('reversa los puntos bonus de la reserva con un asiento bonus_reversal', async () => {
    const tx = clawbackTx([{ id: 'l1', businessId: 'b1', customerId: 'c1', points: 150 }], [])
    await reverseAutoRewardsForBooking(tx, 'bk1', new Date())
    expect(tx.loyaltyLedger.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ points: -150, reason: 'bonus_reversal', dedupeKey: 'reversal:l1' }) }))
  })
  it('reversa grants automáticos activos (flip a reversed)', async () => {
    const tx = clawbackTx([], [{ id: 'g1' }])
    await reverseAutoRewardsForBooking(tx, 'bk1', new Date())
    expect(tx.promotionGrant.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'g1', status: 'active' }),
      data: expect.objectContaining({ status: 'reversed' }) }))
  })
}
```
> (Cerrar el `describe` anterior antes de éste; el ejemplo asume que se agrega como bloque nuevo.)

- [ ] **Step 2: Verificar que falla**

Run: `npx vitest run tests/unit/loyalty-automatic-emit.test.ts`
Expected: FAIL (`reverseAutoRewardsForBooking` no existe).

- [ ] **Step 3: Implementar en `src/lib/loyalty/automatic.ts`** (agregar)

```ts
/** Clawback de recompensas automáticas gatilladas por una reserva (first_visit/referral),
 *  cuando `LoyaltyConfig.clawbackAutoRewardOnRefund` está activo. Idempotente.
 *  - puntos bonus: asiento `bonus_reversal` por -points (dedup `reversal:${ledgerId}`).
 *  - grants ganados activos: flip a `reversed`. Si ya se aplicaron/redimieron, se respetan. */
export async function reverseAutoRewardsForBooking(tx: Tx, bookingId: string, now: Date): Promise<void> {
  const bonuses = await tx.loyaltyLedger.findMany({
    where: { reason: 'bonus', metadata: { path: ['triggeringBookingId'], equals: bookingId } },
    select: { id: true, businessId: true, customerId: true, points: true },
  })
  for (const b of bonuses) {
    try {
      await tx.loyaltyLedger.create({
        data: { businessId: b.businessId, customerId: b.customerId, points: -b.points,
          reason: 'bonus_reversal', bookingId: null, dedupeKey: `reversal:${b.id}`,
          metadata: { reversedLedgerId: b.id, triggeringBookingId: bookingId } },
      })
    } catch (e) {
      if (!isP2002(e)) throw e // ya reversado
    }
  }

  const grants = await tx.promotionGrant.findMany({
    where: { status: 'active', metadata: { path: ['triggeringBookingId'], equals: bookingId } },
    select: { id: true },
  })
  for (const g of grants) {
    await tx.promotionGrant.updateMany({
      where: { id: g.id, status: 'active' },
      data: { status: 'reversed', reversedAt: now },
    })
  }
}
```

- [ ] **Step 4: Verificar verde**

Run: `npx vitest run tests/unit/loyalty-automatic-emit.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/loyalty/automatic.ts tests/unit/loyalty-automatic-emit.test.ts
git commit -m "feat(loyalty): clawback de recompensas automáticas por reserva"
```

---

## Task 6: Referral — captura y emisión

**Files:**
- Create: `src/lib/loyalty/referral.ts`
- Test: `tests/unit/loyalty-referral.test.ts`

- [ ] **Step 1: Test fallando** — `tests/unit/loyalty-referral.test.ts`

```ts
import { describe, it, expect, vi } from 'vitest'
import { captureReferral, rewardReferralOnCompletion } from '@/lib/loyalty/referral'

describe('captureReferral', () => {
  function tx(referrer: any) {
    return {
      customer: { findFirst: vi.fn().mockResolvedValue(referrer) },
      referral: { create: vi.fn().mockResolvedValue({ id: 'rf1' }) },
    } as any
  }
  it('crea Referral pending cuando el ref es válido y no es self', async () => {
    const t = tx({ id: 'ref1', businessId: 'b1', phone: '111' })
    await captureReferral(t, { businessId: 'b1', referredCustomerId: 'c2',
      referrerToken: 'tok', referredPhone: '222' })
    expect(t.referral.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ referrerCustomerId: 'ref1', referredCustomerId: 'c2', status: 'pending' }) }))
  })
  it('no crea si el token no resuelve a una referidora', async () => {
    const t = tx(null)
    await captureReferral(t, { businessId: 'b1', referredCustomerId: 'c2', referrerToken: 'x', referredPhone: '222' })
    expect(t.referral.create).not.toHaveBeenCalled()
  })
  it('no crea self-referral (mismo teléfono)', async () => {
    const t = tx({ id: 'ref1', businessId: 'b1', phone: '222' })
    await captureReferral(t, { businessId: 'b1', referredCustomerId: 'c2', referrerToken: 'tok', referredPhone: '222' })
    expect(t.referral.create).not.toHaveBeenCalled()
  })
})

describe('rewardReferralOnCompletion', () => {
  it('flip pending->rewarded y emite a ambas si beneficiary both', async () => {
    const emit = vi.fn().mockResolvedValue({ kind: 'points', points: 50, ledgerId: 'l' })
    const t = {
      referral: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUnique: vi.fn().mockResolvedValue({ referrerCustomerId: 'ref1', referredCustomerId: 'c2' }),
      },
    } as any
    const rule = { id: 'r', businessId: 'b1', conditions: { kind: 'referral', beneficiary: 'both' },
      rewardPoints: 50, rewardType: null, rewardValue: 0, appliesToAll: true, grantExpiryDays: null, services: [] }
    await rewardReferralOnCompletion(t, { businessId: 'b1', referredCustomerId: 'c2', bookingId: 'bk',
      rule: rule as any, config: { grantExpiryDays: null, forfeitGrantOnNoShow: false }, now: new Date(), emit })
    expect(t.referral.updateMany).toHaveBeenCalled()
    expect(emit).toHaveBeenCalledTimes(2) // referida + referidora
  })
  it('no emite si no había referral pendiente (count 0)', async () => {
    const emit = vi.fn()
    const t = { referral: { updateMany: vi.fn().mockResolvedValue({ count: 0 }), findUnique: vi.fn() } } as any
    await rewardReferralOnCompletion(t, { businessId: 'b1', referredCustomerId: 'c2', bookingId: 'bk',
      rule: {} as any, config: { grantExpiryDays: null, forfeitGrantOnNoShow: false }, now: new Date(), emit })
    expect(emit).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Verificar que falla**

Run: `npx vitest run tests/unit/loyalty-referral.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar `src/lib/loyalty/referral.ts`**

```ts
import type { Prisma } from '@prisma/client'
import { isP2002 } from './credit'
import { referralKey } from './automatic-match'
import { emitAutomaticReward, type AutomaticRule, type EmitConfig, type EmittedReward } from './automatic'

type Tx = Prisma.TransactionClient

/** Estampa la atribución de referida al crear la reserva pública: resuelve a la referidora
 *  por su loyaltyToken (mismo negocio), descarta self-referral, y crea el Referral(pending).
 *  Falla suave: cualquier inconsistencia => no-op (la reserva se crea igual). */
export async function captureReferral(tx: Tx, args: {
  businessId: string; referredCustomerId: string; referrerToken: string; referredPhone: string
}): Promise<void> {
  const referrer = await tx.customer.findFirst({
    where: { loyaltyToken: args.referrerToken, businessId: args.businessId },
    select: { id: true, businessId: true, phone: true },
  })
  if (!referrer) return
  if (referrer.id === args.referredCustomerId) return
  if (referrer.phone === args.referredPhone) return // self-referral por teléfono
  try {
    await tx.referral.create({
      data: { businessId: args.businessId, referrerCustomerId: referrer.id,
        referredCustomerId: args.referredCustomerId, status: 'pending' },
    })
  } catch (e) {
    if (!isP2002(e)) throw e // ya referida (unique referredCustomerId): no-op
  }
}

type EmitFn = (tx: Tx, a: {
  rule: AutomaticRule; businessId: string; customerId: string; dedupeKey: string
  config: EmitConfig; triggeringBookingId?: string | null; now: Date
}) => Promise<EmittedReward>

/** Al completar la 1ª reserva de la referida: flip atómico pending->rewarded y emisión a
 *  referida y/o referidora según `beneficiary`. `emit` se inyecta para testear (default real). */
export async function rewardReferralOnCompletion(tx: Tx, args: {
  businessId: string; referredCustomerId: string; bookingId: string
  rule: AutomaticRule; config: EmitConfig; now: Date; emit?: EmitFn
}): Promise<void> {
  const emit = args.emit ?? emitAutomaticReward
  const flip = await tx.referral.updateMany({
    where: { referredCustomerId: args.referredCustomerId, status: 'pending' },
    data: { status: 'rewarded', rewardedAt: args.now, triggeringBookingId: args.bookingId },
  })
  if (flip.count === 0) return // sin referral pendiente o ya premiado

  const ref = await tx.referral.findUnique({
    where: { referredCustomerId: args.referredCustomerId },
    select: { referrerCustomerId: true, referredCustomerId: true },
  })
  if (!ref) return
  const beneficiary = (args.rule.conditions as { beneficiary?: string } | null)?.beneficiary ?? 'both'

  if (beneficiary === 'both' || beneficiary === 'referred') {
    await emit(tx, { rule: args.rule, businessId: args.businessId, customerId: ref.referredCustomerId,
      dedupeKey: `${referralKey(ref.referredCustomerId)}:referred`, config: args.config,
      triggeringBookingId: args.bookingId, now: args.now })
  }
  if (beneficiary === 'both' || beneficiary === 'referrer') {
    await emit(tx, { rule: args.rule, businessId: args.businessId, customerId: ref.referrerCustomerId,
      dedupeKey: `${referralKey(ref.referredCustomerId)}:referrer`, config: args.config,
      triggeringBookingId: args.bookingId, now: args.now })
  }
}
```

- [ ] **Step 4: Verificar verde**

Run: `npx vitest run tests/unit/loyalty-referral.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/loyalty/referral.ts tests/unit/loyalty-referral.test.ts
git commit -m "feat(loyalty): captura y emisión de referidas"
```

---

## Task 7: Cron `runAutomaticLoyalty`

**Files:**
- Create: `src/lib/cron/loyalty-automatic.ts`
- Test: `tests/unit/loyalty-automatic-cron.test.ts`

- [ ] **Step 1: Test fallando** — `tests/unit/loyalty-automatic-cron.test.ts`

```ts
import { describe, it, expect, vi } from 'vitest'
import { selectTimedRuleForCustomer } from '@/lib/cron/loyalty-automatic'

const TZ = 'America/Santiago'
const now = new Date('2026-06-29T12:00:00Z')
const rule = (kind: string, priority: number, extra: any = {}) => ({
  id: kind, priority, conditions: { kind, windowDays: 0, inactivityDays: 90, cooldownDays: 180, ...extra },
})

describe('selectTimedRuleForCustomer', () => {
  it('elige la regla de mayor prioridad entre las que matchean (cumple gana a winback)', () => {
    const cust = { id: 'c1', birthDate: new Date('1990-06-29'),
      firstCompletedAt: new Date('2024-01-01'), lastCompletedAt: new Date('2026-01-01') }
    const rules = [rule('winback', 1), rule('birthday', 5)]
    const sel = selectTimedRuleForCustomer(rules as any, cust as any, now, TZ)
    expect(sel?.id).toBe('birthday')
  })
  it('devuelve null si ninguna matchea', () => {
    const cust = { id: 'c1', birthDate: new Date('1990-01-01'),
      firstCompletedAt: new Date('2026-06-01'), lastCompletedAt: new Date('2026-06-20') }
    const rules = [rule('birthday', 5), rule('winback', 1)]
    expect(selectTimedRuleForCustomer(rules as any, cust as any, now, TZ)).toBeNull()
  })
})
```

- [ ] **Step 2: Verificar que falla**

Run: `npx vitest run tests/unit/loyalty-automatic-cron.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar `src/lib/cron/loyalty-automatic.ts`**

```ts
import { prisma } from '@/lib/db'
import { logger } from '@/lib/logger'
import {
  matchesBirthday, matchesAnniversary, isWinbackInactive,
  occasionKey, sortByPriorityDesc,
} from '@/lib/loyalty/automatic-match'
import { emitAutomaticReward, type AutomaticRule } from '@/lib/loyalty/automatic'

export interface RunAutomaticLoyaltyResult { businesses: number; emitted: number; errors: number }

type TimedRule = AutomaticRule & { priority: number }
type Candidate = { id: string; birthDate: Date | null; firstCompletedAt: Date | null; lastCompletedAt: Date | null }

const TIMED_KINDS = ['birthday', 'anniversary', 'winback'] as const

/** ¿La clienta matchea esta regla temporal hoy? */
function ruleMatches(rule: TimedRule, c: Candidate, now: Date, tz: string): boolean {
  const k = (rule.conditions as { kind: string }).kind
  const p = rule.conditions as { windowDays?: number; inactivityDays?: number }
  if (k === 'birthday') return matchesBirthday(c.birthDate, now, tz, p.windowDays ?? 0)
  if (k === 'anniversary') return matchesAnniversary(c.firstCompletedAt, now, tz, p.windowDays ?? 0)
  if (k === 'winback') return isWinbackInactive(c.lastCompletedAt, now, p.inactivityDays ?? 0)
  return false
}

/** Regla ganadora (mayor prioridad) entre las temporales que matchean a la clienta. Pura. */
export function selectTimedRuleForCustomer(rules: TimedRule[], c: Candidate, now: Date, tz: string): TimedRule | null {
  for (const rule of sortByPriorityDesc(rules)) {
    if (ruleMatches(rule, c, now, tz)) return rule
  }
  return null
}

/** Barrido diario (corre cada hora, idempotente por dedupeKey de ocasión). Emite a lo sumo
 *  una recompensa temporal por (clienta, día) — la de mayor prioridad. */
export async function runAutomaticLoyalty(now: Date = new Date()): Promise<RunAutomaticLoyaltyResult> {
  const businesses = await prisma.business.findMany({
    where: { loyaltyConfig: { isActive: true },
      promotions: { some: { triggerType: 'automatic', isActive: true } } },
    select: { id: true, timezone: true,
      loyaltyConfig: { select: { grantExpiryDays: true, forfeitGrantOnNoShow: true } } },
  })

  let emitted = 0, errors = 0
  for (const biz of businesses) {
    const tz = biz.timezone || 'America/Santiago'
    const config = { grantExpiryDays: biz.loyaltyConfig?.grantExpiryDays ?? null,
      forfeitGrantOnNoShow: biz.loyaltyConfig?.forfeitGrantOnNoShow ?? false }

    const rules = (await prisma.promotion.findMany({
      where: { businessId: biz.id, triggerType: 'automatic', isActive: true },
      select: { id: true, businessId: true, conditions: true, rewardPoints: true, rewardType: true,
        rewardValue: true, maxDiscount: true, appliesToAll: true, grantExpiryDays: true, priority: true,
        services: { select: { id: true } } },
    })).filter((r) => TIMED_KINDS.includes((r.conditions as { kind?: string })?.kind as never)) as TimedRule[]
    if (rules.length === 0) continue

    // Candidatas: las que tienen alguna señal temporal. A la escala de un estudio chico esto
    // es barato; si crece, paginar / indexar por mes-día denormalizado.
    const customers = await prisma.customer.findMany({
      where: { businessId: biz.id,
        OR: [{ birthDate: { not: null } }, { firstCompletedAt: { not: null } }] },
      select: { id: true, birthDate: true, firstCompletedAt: true, lastCompletedAt: true },
    })

    for (const c of customers) {
      const rule = selectTimedRuleForCustomer(rules, c, now, tz)
      if (!rule) continue
      const dedupeKey = occasionKey(c.id, now, tz)
      try {
        const out = await prisma.$transaction((tx) =>
          emitAutomaticReward(tx, { rule, businessId: biz.id, customerId: c.id, dedupeKey, config, now }))
        if (out) emitted++
      } catch (e) {
        errors++
        logger.error('loyalty.automatic_emit_failed', `cron emit falló customer=${c.id} rule=${rule.id}: ${String(e)}`)
      }
    }
  }
  return { businesses: businesses.length, emitted, errors }
}
```

> **Win-back cooldown:** el dedupeKey de ocasión es diario; el cooldown más largo se logra porque, una vez emitido el win-back, la clienta recibe un grant/puntos pero su `lastCompletedAt` no cambia hasta que vuelva — así seguiría matcheando. Para no re-emitir cada día, el win-back se considera **emitido para esa inactividad** si ya hay una emisión `bonus`/grant con `metadata.kind='winback'` posterior a `lastCompletedAt`. Implementar ese guard en `ruleMatches` para `winback`: antes de devolver true, consultar `tx`/`prisma` sería I/O en función pura → en su lugar, precargar por negocio el set de `customerId` con win-back ya emitido desde su última visita y excluirlos. Agregar en `runAutomaticLoyalty`, antes del loop de clientas:
>
> ```ts
> const winbackDone = new Set((await prisma.loyaltyLedger.findMany({
>   where: { businessId: biz.id, reason: 'bonus', metadata: { path: ['kind'], equals: 'winback' } },
>   select: { customerId: true, createdAt: true },
> })).map((l) => l.customerId))
> ```
> y en el loop: si `rule.kind==='winback'` y `winbackDone.has(c.id)` → saltear esa regla (continuar con la siguiente prioridad evaluando manualmente, o excluir win-back de `rules` para esa clienta). Para mantener la prioridad correcta, filtrar la lista de reglas por-clienta: `const applicable = rules.filter(r => !(isWinback(r) && winbackDone.has(c.id)))` y pasar `applicable` a `selectTimedRuleForCustomer`.
>
> El guard exacto del cooldown (volver a habilitar win-back tras `cooldownDays` aunque no haya vuelto) se cubre en los tests de integración de Task 16; para el corte basta "una vez por inactividad".

- [ ] **Step 4: Verificar verde** (los tests cubren la función pura `selectTimedRuleForCustomer`)

Run: `npx vitest run tests/unit/loyalty-automatic-cron.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/cron/loyalty-automatic.ts tests/unit/loyalty-automatic-cron.test.ts
git commit -m "feat(loyalty): cron de condiciones temporales (barrido idempotente)"
```

---

## Task 8: Endpoint de cron + workflow

**Files:**
- Create: `src/app/api/cron/loyalty-automatic/route.ts`
- Modify: `.github/workflows/cron.yml`

- [ ] **Step 1: Implementar el route** (molde idéntico a `send-reminders/route.ts`)

```ts
import { NextRequest, NextResponse } from 'next/server'
import { runAutomaticLoyalty } from '@/lib/cron/loyalty-automatic'
import { logger } from '@/lib/logger'

/**
 * Cron de condiciones automáticas de fidelización (cumpleaños/aniversario/win-back).
 * Lo dispara GitHub Actions (POST) cada hora; idempotente por dedupeKey de ocasión.
 * Auth: Authorization: Bearer ${CRON_SECRET}.
 */
async function handler(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  const expectedSecret = process.env.CRON_SECRET
  if (!expectedSecret || authHeader !== `Bearer ${expectedSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const result = await runAutomaticLoyalty()
  logger.info('loyalty.automatic_cron',
    `Cron loyalty-automatic: businesses=${result.businesses} emitted=${result.emitted} errors=${result.errors}`)
  return NextResponse.json(result)
}

export const GET = handler
export const POST = handler
```

- [ ] **Step 2: Agregar el step en `.github/workflows/cron.yml`** (tras "Send reminders")

```yaml
      - name: Loyalty automatic conditions
        run: |
          curl -fsS --max-time 60 -X POST "$BASE_URL/api/cron/loyalty-automatic" \
            -H "Authorization: Bearer ${{ secrets.CRON_SECRET }}"
```

- [ ] **Step 3: Verificar typecheck**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | head -20`
Expected: sin errores nuevos.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/cron/loyalty-automatic/route.ts .github/workflows/cron.yml
git commit -m "feat(loyalty): endpoint + workflow del cron de condiciones automáticas"
```

---

## Task 9: Wiring de completación (first_visit + referral + firstCompletedAt/lastCompletedAt)

**Files:**
- Modify: `src/server/actions/bookings.ts` (dentro de `updateBookingStatus`, bloque `$transaction`, líneas ~418-443)

- [ ] **Step 1: Crear el helper de emisión por evento** en `src/lib/loyalty/automatic.ts` (agregar)

```ts
import { firstVisitKey } from './automatic-match'

/** Carga la regla automática activa de un kind para un negocio (a lo sumo una). */
export async function loadAutomaticRule(tx: Tx, businessId: string, kind: string): Promise<AutomaticRule | null> {
  const rules = await tx.promotion.findMany({
    where: { businessId, triggerType: 'automatic', isActive: true },
    select: { id: true, businessId: true, conditions: true, rewardPoints: true, rewardType: true,
      rewardValue: true, maxDiscount: true, appliesToAll: true, grantExpiryDays: true, priority: true,
      services: { select: { id: true } } },
  })
  return rules.find((r) => (r.conditions as { kind?: string })?.kind === kind) ?? null
}
```

> **⚠️ CORRECCIÓN R-EMIT (obligatoria):** el bloque de abajo muestra los emits DENTRO de la tx —
> **NO implementarlo así**. La tx principal debe hacer SOLO flip + marcas (`firstCompletedAt`/
> `lastCompletedAt`) + `creditVisitPoints`, y devolver `{ customerId, isFirstVisit }` (calcular
> `isFirstVisit = prevCompleted === 0` dentro de la tx). **Después del commit**, ya fuera de la tx,
> emitir en transacciones separadas: si `isFirstVisit`, `await prisma.$transaction(tx =>
> emitAutomaticReward(tx, {... first_visit, dedupeKey: firstVisitKey, triggeringBookingId: id}))`
> (precedido de `loadAutomaticRule`); y siempre `await prisma.$transaction(tx =>
> rewardReferralOnCompletion(tx, {businessId, referredCustomerId: customerId, bookingId: id, rule,
> config, now}))` si hay regla referral. Cada emisión es idempotente; una pérdida por crash
> post-commit es aceptable. Gate `loyaltyConfig.isActive` antes de emitir. El email transaccional
> (G4) va best-effort tras cada emisión, fuera de la tx.

- [ ] **Step 2: Editar `updateBookingStatus`** — el bloque de referencia (a SEPARAR según R-EMIT). Dentro del `$transaction`, en el branch `status === completed`, después del `creditVisitPoints` existente, la lógica conceptual es:

```ts
    if (res.count > 0 && status === BookingStatus.completed && loyaltyConfig?.isActive) {
      await creditVisitPoints(tx, {
        businessId,
        customerId: existing.customerId,
        finalAmount: existing.finalAmount,
        bookingId: id,
        config: loyaltyConfig,
      })
    }
```
por:
```ts
    if (res.count > 0 && status === BookingStatus.completed && existing.customerId) {
      // Marca de primera/última completación (sirve a aniversario y win-back del cron).
      const prevCompleted = await tx.booking.count({
        where: { customerId: existing.customerId, status: BookingStatus.completed, id: { not: id } },
      })
      const now = new Date()
      await tx.customer.update({
        where: { id: existing.customerId },
        data: { lastCompletedAt: now, ...(prevCompleted === 0 ? { firstCompletedAt: now } : {}) },
      })

      if (loyaltyConfig?.isActive) {
        await creditVisitPoints(tx, {
          businessId, customerId: existing.customerId, finalAmount: existing.finalAmount,
          bookingId: id, config: loyaltyConfig,
        })
        const emitCfg = { grantExpiryDays: loyaltyConfig.grantExpiryDays,
          forfeitGrantOnNoShow: loyaltyConfig.forfeitGrantOnNoShow }

        // first_visit: solo en la 1ª completación.
        if (prevCompleted === 0) {
          const rule = await loadAutomaticRule(tx, businessId, 'first_visit')
          if (rule) await emitAutomaticReward(tx, { rule, businessId, customerId: existing.customerId,
            dedupeKey: firstVisitKey(existing.customerId), config: emitCfg, triggeringBookingId: id, now })
        }
        // referral: si esta clienta fue referida y hay una regla activa.
        const refRule = await loadAutomaticRule(tx, businessId, 'referral')
        if (refRule) await rewardReferralOnCompletion(tx, { businessId, customerId: existing.customerId,
          referredCustomerId: existing.customerId, bookingId: id, rule: refRule, config: emitCfg, now })
      }
    }
```

> Imports a agregar en `bookings.ts`: `import { emitAutomaticReward, loadAutomaticRule } from '@/lib/loyalty/automatic'`, `import { rewardReferralOnCompletion } from '@/lib/loyalty/referral'`, `import { firstVisitKey } from '@/lib/loyalty/automatic-match'`. Ajustar la firma de `rewardReferralOnCompletion` (no recibe `customerId`, solo `referredCustomerId`): la llamada correcta es `rewardReferralOnCompletion(tx, { businessId, referredCustomerId: existing.customerId, bookingId: id, rule: refRule, config: emitCfg, now })`.

- [ ] **Step 3: Verificar que la suite existente sigue verde** (los mocks de `updateBookingStatus` en `dashboard-bookings-advanced.test.ts` necesitarán los nuevos accessors). Correr:

Run: `npx vitest run tests/unit/dashboard-bookings-advanced.test.ts`
Expected: si falla por mocks faltantes (`tx.booking.count`, `tx.customer.update`, `tx.promotion.findMany`, `tx.referral.updateMany`), agregar esos stubs al mock del test devolviendo valores neutros (`count: 0`, `findMany: []`, `updateMany: { count: 0 }`). Dejar verde.

- [ ] **Step 4: Commit**

```bash
git add src/lib/loyalty/automatic.ts src/server/actions/bookings.ts tests/unit/dashboard-bookings-advanced.test.ts
git commit -m "feat(loyalty): wire first_visit + referral + marcas de completación"
```

---

## Task 10: Wiring de reseña → premio

**Files:**
- Modify: `src/server/actions/reviews.ts` (`submitReview`, líneas ~126-149)

- [ ] **Step 1: Editar `submitReview`** — reemplazar el bloque que crea la review por una tx que crea la review y emite el premio:

```ts
  try {
    const review = await prisma.$transaction(async (tx) => {
      const created = await tx.review.create({
        data: {
          businessId: booking.businessId, bookingId: booking.id, customerId: booking.customerId,
          rating, comment: comment || null, isApproved: false, isHidden: false,
        },
      })
      // Premio por reseña (al enviar, cualquier rating, 1 por reserva).
      if (booking.customerId) {
        const config = await tx.loyaltyConfig.findUnique({ where: { businessId: booking.businessId } })
        if (config?.isActive) {
          const rule = await loadAutomaticRule(tx, booking.businessId, 'review')
          if (rule) await emitAutomaticReward(tx, { rule, businessId: booking.businessId,
            customerId: booking.customerId, dedupeKey: reviewKey(booking.customerId, booking.id),
            config: { grantExpiryDays: config.grantExpiryDays, forfeitGrantOnNoShow: config.forfeitGrantOnNoShow },
            triggeringBookingId: booking.id, now: new Date() })
        }
      }
      return created
    })

    await revalidateBusinessPublicPaths(booking.businessId)
    revalidatePath('/dashboard/reviews')
    return review
  } catch (e: unknown) {
    const prismaError = e as { code?: string }
    if (prismaError.code === 'P2002') {
      throw new Error('Ya enviaste una reseña para esta reserva')
    }
    throw e
  }
```

> Imports en `reviews.ts`: `import { emitAutomaticReward, loadAutomaticRule } from '@/lib/loyalty/automatic'`, `import { reviewKey } from '@/lib/loyalty/automatic-match'`.
> `revalidateBusinessPublicPaths` debe ir **con `await`** (regla de repo); ya lo está en el archivo. `revalidatePath('/dashboard/reviews')` queda igual.

- [ ] **Step 2: Verificar suite de reviews**

Run: `npx vitest run tests/unit 2>&1 | tail -20`
Expected: si hay tests de `submitReview` que mockean `prisma.review.create`, actualizarlos para mockear `prisma.$transaction` (callback) con `tx.review.create`, `tx.loyaltyConfig.findUnique` (→ null), `tx.promotion.findMany` (→ []). Dejar verde.

- [ ] **Step 3: Commit**

```bash
git add src/server/actions/reviews.ts tests/unit
git commit -m "feat(loyalty): wire reseña → premio automático"
```

---

## Task 11: Captura de referral en reserva pública + fix de `listPromotions`

**Files:**
- Modify: `src/server/actions/bookings.ts` (`createBooking`, branch de creación de cliente ~250-259; firma ~150-159)
- Modify: `src/server/actions/promotions.ts` (`listPromotions`, línea ~124)

- [ ] **Step 1: Agregar `referralToken` opcional a la firma de `createBooking`**

En el objeto `data` de `createBooking` agregar `referralToken?: string` (junto a `promotionCode?`). En `createBookingSchema` (en `src/lib/bookings/schema.ts` o donde viva) agregar el campo opcional: `referralToken: z.string().trim().max(64).optional()`.

- [ ] **Step 2: Capturar al crear cliente nuevo** — en el branch `if (!customer) { customer = await tx.customer.create(...) }`, justo después de crear, agregar:

```ts
      if (!customer) {
        customer = await tx.customer.create({
          data: { businessId, name: data.customerName, phone: data.customerPhone,
            email: data.customerEmail || null },
        })
        // Atribución de referida: solo clientas nuevas (recién creadas).
        if (data.referralToken) {
          await captureReferral(tx, { businessId, referredCustomerId: customer.id,
            referrerToken: data.referralToken, referredPhone: data.customerPhone })
        }
      }
```

> Import en `bookings.ts`: `import { captureReferral } from '@/lib/loyalty/referral'`.

- [ ] **Step 3: Fix `listPromotions`** en `src/server/actions/promotions.ts` — cambiar:

```ts
    where: { businessId, triggerType: { not: 'granted' } },
```
por:
```ts
    where: { businessId, triggerType: 'code' },
```

- [ ] **Step 4: Verificar suite**

Run: `npx vitest run tests/unit 2>&1 | tail -15`
Expected: verde (ajustar mocks de `createBooking` si fallan por `tx.referral.create`).

- [ ] **Step 5: Commit**

```bash
git add src/server/actions/bookings.ts src/server/actions/promotions.ts src/lib/bookings tests/unit
git commit -m "feat(loyalty): captura de referral en reserva pública + listPromotions solo code"
```

---

## Task 12: Clawback en webhook MP (gated)

**Files:**
- Modify: `src/app/api/webhooks/mercado-pago/route.ts` (~433-434)

- [ ] **Step 1: Editar el branch `refunded`** — donde hoy hace `releaseRedemptionForBooking(tx, payment.bookingId, 'refunded')`, agregar el clawback condicional:

```ts
        if (finalStatus === 'refunded' && payment.bookingId) {
          await releaseRedemptionForBooking(tx, payment.bookingId, 'refunded')
          const cfg = await tx.loyaltyConfig.findUnique({
            where: { businessId: payment.businessId }, select: { clawbackAutoRewardOnRefund: true },
          })
          if (cfg?.clawbackAutoRewardOnRefund) {
            await reverseAutoRewardsForBooking(tx, payment.bookingId, new Date())
          }
        }
```

> Import: `import { reverseAutoRewardsForBooking } from '@/lib/loyalty/automatic'`. Verificar que `payment.businessId` esté disponible en ese scope; si no, leerlo del booking (`tx.booking.findUnique({ where:{id}, select:{businessId:true} })`).
> **Nota:** los puntos de visita (B1) ya se reversan en este webhook vía su propio path; el clawback de B3 es solo para las recompensas automáticas.

- [ ] **Step 2: Verificar typecheck + suite del webhook**

Run: `npx vitest run tests/unit 2>&1 | tail -15`
Expected: verde (agregar `loyaltyConfig.findUnique` y `reverseAutoRewardsForBooking` stubs al mock del webhook si aplica).

- [ ] **Step 3: Commit**

```bash
git add src/app/api/webhooks/mercado-pago/route.ts tests/unit
git commit -m "feat(loyalty): clawback de recompensas automáticas al reembolsar (gated)"
```

---

## Task 13: Email transaccional de recompensa

**Files:**
- Modify: `src/lib/notifications/index.ts` (o el barrel de notificaciones) — agregar `sendLoyaltyRewardNotification`
- Modify: emisores de eventos para disparar el email best-effort

- [ ] **Step 1: Agregar la notificación** siguiendo el patrón de `sendReviewRequestNotification` (mismo provider Resend, plantilla simple). Firma:

```ts
export async function sendLoyaltyRewardNotification(args: {
  businessName: string; customerName: string; customerEmail: string
  rewardLabel: string // ej. "un 20% de descuento" o "150 puntos"
  reason: 'birthday' | 'winback' | 'referral'
  loyaltyCardLink: string | null
}): Promise<{ success: boolean; skipped?: string }>
```
Cuerpo: asunto contextual por `reason` (cumpleaños / "te extrañamos" / "gracias por recomendarnos"), CTA al `loyaltyCardLink`. Reusar el layout de email existente.

- [ ] **Step 2: Disparar best-effort** tras emitir, **fuera** de la tx (patrón `sendNotificationSafely`). En el cron (`runAutomaticLoyalty`), tras un `emit` exitoso de birthday/winback, y en `rewardReferralOnCompletion`'s caller, resolver email de la clienta + `buildLoyaltyCardLink` y llamar `sendNotificationSafely('loyalty_reward', () => sendLoyaltyRewardNotification(...))`. No bloquear ni romper la emisión si el email falla.

> **Scope:** solo `birthday`, `winback`, `referral` mandan email (G4). `first_visit`/`review`/`anniversary` quedan visibles en "Mi tarjeta" sin email transaccional (evita ruido; ampliable en C).

- [ ] **Step 3: Verificar typecheck + lint**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | head; npm run lint 2>&1 | tail -5`
Expected: limpio.

- [ ] **Step 4: Commit**

```bash
git add src/lib/notifications src/lib/cron/loyalty-automatic.ts src/lib/loyalty/referral.ts
git commit -m "feat(loyalty): email transaccional de recompensa (cumpleaños/winback/referral)"
```

---

## Task 14: Server actions — CRUD de reglas + link de referido

**Files:**
- Modify: `src/server/actions/loyalty.ts`

- [ ] **Step 1: Agregar helpers module-local (no exportados)** — `automaticRuleWhere` y el select, junto a los de B2:

```ts
function automaticRuleWhere(businessId: string) {
  return { businessId, triggerType: 'automatic' as const }
}
```

- [ ] **Step 2: Acciones async exportadas** (todas async — regla de repo):

```ts
export async function listAutomaticRules() {
  const { businessId } = await requireBusinessRole(['owner', 'admin'])
  return prisma.promotion.findMany({
    where: automaticRuleWhere(businessId), orderBy: { priority: 'desc' },
    include: { services: { select: { id: true, name: true } } },
  })
}

export async function upsertAutomaticRule(data: unknown, id?: string) {
  const { businessId, user } = await requireBusinessRole(['owner', 'admin'])
  const limit = await checkRateLimit('automatic-rule', 30, 60000, { userId: user.id, businessId })
  if (!limit.success) throw new Error('Demasiadas solicitudes. Intenta más tarde.')
  const parsed = automaticRuleSchema.safeParse(data)
  if (!parsed.success) throw new Error('Datos inválidos: ' + parsed.error.issues.map(i => i.message).join(', '))
  const d = parsed.data
  if (d.rewardKind === 'grant' && d.serviceIds.length) {
    const count = await prisma.service.count({ where: { id: { in: d.serviceIds }, businessId } })
    if (count !== d.serviceIds.length) throw new Error('Servicio inválido')
  }
  // Una regla por (negocio, kind): si ya existe otra del mismo kind, rechazar.
  const existingSameKind = await prisma.promotion.findFirst({
    where: { ...automaticRuleWhere(businessId), id: id ? { not: id } : undefined },
    select: { id: true, conditions: true },
  })
  // (filtrar por kind sobre conditions JSON en JS si hace falta)
  const scalars = {
    name: `auto:${d.kind}`, rewardType: d.rewardType ?? 'percentage', rewardValue: d.rewardValue,
    maxDiscount: d.maxDiscount, appliesToAll: d.appliesToAll, rewardPoints: d.rewardPoints,
    grantExpiryDays: d.grantExpiryDays, priority: d.priority, isActive: d.isActive,
    conditions: buildConditions(d) as Prisma.InputJsonValue,
  }
  if (id) {
    const existing = await prisma.promotion.findFirst({ where: { id, ...automaticRuleWhere(businessId) }, select: { id: true } })
    if (!existing) throw new ForbiddenError('Regla no encontrada')
    await prisma.promotion.update({ where: { id }, data: { ...scalars, updatedByUserId: user.id,
      services: d.appliesToAll || d.rewardKind === 'points' ? { set: [] } : { set: d.serviceIds.map(sid => ({ id: sid })) } } })
  } else {
    await prisma.promotion.create({ data: { businessId, triggerType: 'automatic', ...scalars, createdByUserId: user.id,
      services: d.rewardKind === 'grant' && !d.appliesToAll ? { connect: d.serviceIds.map(sid => ({ id: sid })) } : undefined } })
  }
  await revalidatePath('/dashboard/fidelizacion')
}

export async function archiveAutomaticRule(id: string) {
  const { businessId } = await requireBusinessRole(['owner', 'admin'])
  const existing = await prisma.promotion.findFirst({ where: { id, ...automaticRuleWhere(businessId) }, select: { id: true } })
  if (!existing) throw new ForbiddenError('Regla no encontrada')
  await prisma.promotion.update({ where: { id }, data: { isActive: false } })
  await revalidatePath('/dashboard/fidelizacion')
}

export async function getReferralShareLink(customerId: string): Promise<{ url: string; waUrl: string | null } | null> {
  const { businessId } = await requireBusinessRole(['owner', 'admin'])
  const customer = await prisma.customer.findFirst({ where: { id: customerId, businessId },
    select: { id: true, name: true, phone: true, loyaltyToken: true, business: { select: { slug: true, subdomain: true, name: true } } } })
  if (!customer) throw new ForbiddenError('Clienta no encontrada')
  const token = await resolveOrCreateToken(prisma, customer) // lazy
  const base = getAppUrl('') // dominio canónico
  const url = `${base}/${customer.business.subdomain ?? customer.business.slug}?ref=${token}`
  const message = `Te invito a ${customer.business.name} ✨ Reservá con mi link y las dos ganamos un premio:\n${url}`
  const waUrl = customer.phone ? `https://wa.me/?text=${encodeURIComponent(message)}` : null
  return { url, waUrl }
}
```

> Imports a agregar en `loyalty.ts`: `automaticRuleSchema`, `buildConditions` desde `@/lib/loyalty/schema`; `resolveOrCreateToken` desde `@/lib/loyalty/token`; `getAppUrl` desde `@/lib/business/urls`; `Prisma` desde `@prisma/client`. Confirmar el nombre real del helper de token (en `token.ts` la función lazy se llama `resolveOrCreateToken` o `buildLoyaltyCardLink`; usar la que devuelve/garantiza el token). Confirmar la forma de la URL pública del negocio (revisar cómo arma links `buildLoyaltyCardLink`).

- [ ] **Step 3: Verificar typecheck + que todos los exports sean async**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | head -20`
Expected: limpio. Revisar manualmente que `loyalty.ts` no exporte ninguna const/objeto (regla `'use server'`).

- [ ] **Step 4: Commit**

```bash
git add src/server/actions/loyalty.ts
git commit -m "feat(loyalty): server actions de reglas automáticas + link de referido"
```

---

## Task 15: UI — Reglas automáticas en /dashboard/fidelizacion + toggle clawback

**Files:**
- Create: `src/app/dashboard/fidelizacion/automatic-rules.tsx`
- Modify: `src/app/dashboard/fidelizacion/page.tsx`, `loyalty-config-form.tsx`

- [ ] **Step 1: `automatic-rules.tsx`** — client component que lista los 6 kinds (1 card por kind, M1) con: switch activar, selector recompensa (puntos N | grant: tipo+valor+servicios+expiración), inputs de parámetros según kind (windowDays / inactivityDays+cooldownDays / beneficiary), input `priority`. Submit por `<form action>` con FormData → `upsertAutomaticRule`. Seguir el patrón de `redemption-catalog.tsx` (B2): mismo manejo de FormData, checkbox `=== 'on'`, helper `optNum`. Cargar reglas con `listAutomaticRules()` en el `page.tsx` (server) y pasarlas como prop.

> Etiquetas en español por kind: `birthday`→"Cumpleaños", `first_visit`→"Primera visita", `review`→"Reseña", `anniversary`→"Aniversario (1 año)", `winback`→"Reactivar inactivas", `referral`→"Referidas". Currency-clean: montos con `formatMoney`.

- [ ] **Step 2: Toggle clawback** en `loyalty-config-form.tsx` — agregar un checkbox `clawbackAutoRewardOnRefund` (mismo patrón que `forfeitGrantOnNoShow`), y mapearlo en `loyaltyConfigSchema` (Task 2 ya no lo incluye → agregarlo ahí: `clawbackAutoRewardOnRefund: z.boolean().optional().default(false)`). Asegurar que `upsertLoyaltyConfig` lo persista (el spread `...d` ya lo cubre).

> **Importante:** agregar `clawbackAutoRewardOnRefund` a `loyaltyConfigSchema` en `src/lib/loyalty/schema.ts` (no quedó en Task 2). Hacerlo en este step para mantener el form consistente.

- [ ] **Step 3: Render en `page.tsx`** — agregar `<AutomaticRules rules={rules} services={services} pointsLabel={...} currency={...} />` bajo la sección de catálogo de canje de B2.

- [ ] **Step 4: Verificar build/lint**

Run: `npm run lint 2>&1 | tail -5; npx tsc --noEmit -p tsconfig.json 2>&1 | head`
Expected: limpio.

- [ ] **Step 5: Commit**

```bash
git add src/app/dashboard/fidelizacion src/lib/loyalty/schema.ts
git commit -m "feat(loyalty): UI de reglas automáticas + toggle clawback"
```

---

## Task 16: UI — "Referí a una amiga" + captura de `?ref=` en reserva pública

**Files:**
- Modify: `src/app/tarjeta/[token]/page.tsx` (sección de referido)
- Modify: página pública de reserva (form) y su server action wiring para pasar `referralToken`

- [ ] **Step 1: Sección referido en "Mi tarjeta"** — en `tarjeta/[token]/page.tsx`, si `loyaltyConfig.isActive` y existe una regla `referral` activa, mostrar un bloque "Referí a una amiga" con el link `{{appUrl}}/{{businessSlug}}?ref={{token}}` (el token ya es el de la página) y un botón "Compartir por WhatsApp" (`wa.me/?text=...`). El token de la URL es el de la clienta dueña de la tarjeta → es su propio ref.

- [ ] **Step 2: Capturar `?ref=` en la reserva pública** — en la página pública de reserva (server component que lee `searchParams`), leer `searchParams.ref`, pasarlo al form, y que el form lo incluya como hidden/estado para mandarlo en `createBooking({ ..., referralToken })`. Validar largo máx. (64). No mostrarlo a la clienta (es transparente).

> Revisar el componente real del form público de reserva (probablemente en `src/app/[business]/...` o `src/app/(public)/...`) para enganchar `referralToken` en el submit que llama `createBooking`.

- [ ] **Step 3: Verificar build/lint**

Run: `npm run lint 2>&1 | tail -5; npx tsc --noEmit -p tsconfig.json 2>&1 | head`
Expected: limpio.

- [ ] **Step 4: Commit**

```bash
git add src/app
git commit -m "feat(loyalty): compartir referido en Mi tarjeta + captura de ?ref en reserva"
```

---

## Task 17: Suite + lint + integración + e2e + gate de migración + PR

**Files:**
- Create: scripts de integración/e2e (en raíz del repo o `tests/e2e/`, según B2)

- [ ] **Step 1: Suite unit completa + lint**

Run: `npm test 2>&1 | tail -15 && npm run lint 2>&1 | tail -5`
Expected: 100% verde (todos los tests previos + los nuevos de B3), lint limpio. Arreglar mocks de tests de integración de bookings/reviews/webhook que toquen los nuevos accessors.

- [ ] **Step 2: GATE DE MIGRACIÓN — pedir confirmación explícita al usuario** antes de aplicar a la DB.

Cuando el usuario confirme, aplicar la migración aditiva a la DB de la misma forma que B2 (drift conocido → `prisma db execute` del `.sql`, no `migrate deploy`):

```bash
npx dotenvx run -f .env.local -- npx prisma db execute --file prisma/migrations/<timestamp>_add_automatic_loyalty/migration.sql --schema prisma/schema.prisma
```
> Si los `ALTER TYPE ... ADD VALUE` fallan dentro de una transacción, ejecutarlos por separado (Postgres no permite `ADD VALUE` en tx con otras DDL). Verificar luego con `prisma db execute` de un `SELECT` o con Studio que existan las columnas/tabla.

- [ ] **Step 3: e2e Playwright (header bypass, Postgres real)** — un spec que: configura una regla de cada kind en `/dashboard/fidelizacion`; completa una reserva nueva y verifica primera-visita (grant/puntos en panel de clienta); envía una reseña y verifica el premio; flujo de referral end-to-end (genera link en Mi tarjeta → reserva nueva con `?ref=` → completa → ambas premiadas); valida el gate `config.isActive` (pausar ⇒ no emite). Lanzar con:

```bash
ENABLE_E2E_AUTH_BYPASS=true npx dotenvx run -f .env.local -- npx playwright test tests/e2e/loyalty-automatic.spec.ts
```

- [ ] **Step 4: Integración del cron (Postgres real)** — script ts-node que: siembra una clienta con cumpleaños hoy + regla birthday; corre `runAutomaticLoyalty(now)` **dos veces**; verifica **una sola** emisión (idempotencia de ocasión). Usar el wrapper tsconfig de B2 (`_e2e.tsconfig.json` con `baseUrl`) si se importan paths `@/`.

- [ ] **Step 5: Commit final + abrir PR (NO mergear hasta OK del usuario)**

```bash
git add -A
git commit -m "test(loyalty): e2e + integración B3 (condiciones automáticas)"
git push -u origin feat/loyalty-automatic-B3
gh pr create --title "feat(loyalty): condiciones automáticas (rebanada B3)" \
  --body "$(cat <<'EOF'
Rebanada B3: condiciones automáticas (cumpleaños, aniversario, win-back, primera visita, reseña→premio, referidas).

- Reglas = Promotion(triggerType='automatic') + conditions JSON; recompensa puntos o grant.
- Eventos: first_visit/referral en updateBookingStatus, review en submitReview.
- Temporal: cron horario idempotente (dedupe por ocasión, prioridad configurable).
- Referidas: entidad Referral + captura por ?ref + premio al completar (beneficiaria configurable).
- Clawback configurable (default off). Email transaccional cumpleaños/winback/referral.
- Migración aditiva aplicada a la DB. Suite + e2e Playwright verdes.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-review (cobertura del spec)

- **§2 modelo (Promotion automatic + conditions):** T1, T2, T14 ✓
- **§2 recompensa puntos|grant:** T2 (schema), T4 (emisor) ✓
- **§2 precedencia configurable:** T3 (sortByPriorityDesc), T7 (selectTimedRuleForCustomer) ✓
- **§2 referidas configurable:** T6, T9, T16 ✓
- **§2 clawback configurable:** T5, T12, T15 ✓
- **§2 reseña al enviar:** T10 ✓
- **§2 email (G4):** T13 ✓
- **§2 una regla por kind (M1):** T14 ✓
- **§2 gate isActive (M3):** T7, T9, T10 ✓
- **§3 disparadores:** T7 (cron), T8 (endpoint), T9/T10/T11 (eventos) ✓
- **§5 idempotencia (dedupeKey/ocasión):** T1 (unique), T3 (keys), T4/T7 ✓
- **§6 emisor:** T4 ✓
- **§7 referral entidad/captura/emisión:** T1, T6, T9, T11, T16 ✓
- **§8 clawback:** T5, T12 ✓
- **§9 listPromotions/labels/firstCompletedAt:** T11, T2, T1/T9 ✓
- **§10 schema delta:** T1 ✓
- **§11 testing:** T17 ✓

Sin placeholders en pasos de código. Tipos consistentes (`AutomaticRule`, `EmitConfig`, `EmittedReward`, keys) entre T3–T9.
